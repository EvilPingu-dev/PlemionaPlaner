"""Routes: plan execution, settings, plan edit helpers."""
from datetime import datetime

from flask import Blueprint, jsonify, request

from ..planner import _dist, is_night_send, plan_action
from ..storage import (
    ATTACK_STATUS_FILE,
    BURST_TARGETS_FILE,
    CONFLICTS_FILE,
    FAKE_TARGETS_FILE,
    PLAN_FILE,
    PLAYER_MAP_FILE,
    PLAYER_POINTS_FILE,
    SEPARATIONS_FILE,
    SETTINGS_FILE,
    TARGET_OWNERS_FILE,
    TARGET_POINTS_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_troops,
    load_settings,
    save_json,
)

bp = Blueprint("plan", __name__)


# ── Settings ──────────────────────────────────────────────────────────────────

@bp.get("/api/settings")
def get_settings():
    return jsonify(load_settings())


@bp.post("/api/settings")
def save_settings():
    data = request.json or {}
    save_json(SETTINGS_FILE, data)
    return jsonify({"ok": True})


# ── Planner ───────────────────────────────────────────────────────────────────

@bp.post("/api/plan")
def run_plan():
    villages = load_troops()
    targets  = load_json(TARGETS_FILE)

    if not villages:
        return jsonify({"error": "Brak danych wojsk – importuj wojska najpierw."}), 400
    if not targets:
        return jsonify({"error": "Brak celów – dodaj cele najpierw."}), 400

    player_map = load_json(PLAYER_MAP_FILE)
    disabled_coords: set[str] = set()
    for pm in player_map:
        if not pm.get("enabled", True):
            disabled_coords.update(pm.get("villages", []))

    settings    = load_settings()
    arrival_raw = settings.get("arrival_datetime", "")
    arrival_dt: datetime | None = None
    if arrival_raw:
        try:
            arrival_dt = datetime.fromisoformat(arrival_raw)
        except ValueError:
            pass

    arrival_slots: dict[int, datetime] = {}
    for i, slot in enumerate(settings.get("arrival_slots", []), start=1):
        raw_dt = slot.get("datetime", "")
        if raw_dt:
            try:
                arrival_slots[i] = datetime.fromisoformat(raw_dt)
            except ValueError:
                pass
    if 1 not in arrival_slots and arrival_dt:
        arrival_slots[1] = arrival_dt

    coord_to_player: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            coord_to_player[coord.strip()] = pm["player"]

    # Use real TW points from API fetch if available, fall back to pop sum
    fetched_player_pts = load_json(PLAYER_POINTS_FILE)
    fetched_target_pts = load_json(TARGET_POINTS_FILE)
    if isinstance(fetched_player_pts, dict) and fetched_player_pts:
        player_points = fetched_player_pts
    else:
        player_points: dict[str, int] = {}
        for pm in player_map:
            pop_sum = 0
            for coord in pm.get("villages", []):
                v = next((vv for vv in villages if vv["coord"] == coord.strip()), None)
                if v:
                    pop_sum += v.get("pop", 0)
            player_points[pm["player"]] = pop_sum

    # Auto-fill target points from fetched data when not manually set
    if isinstance(fetched_target_pts, dict) and fetched_target_pts:
        for t in targets:
            if not t.get("points") and t["coord"] in fetched_target_pts:
                t["points"] = fetched_target_pts[t["coord"]]

    conflicts = load_json(CONFLICTS_FILE)
    if not isinstance(conflicts, list):
        conflicts = []

    separations = load_json(SEPARATIONS_FILE)
    if not isinstance(separations, list):
        separations = []

    target_owners = load_json(TARGET_OWNERS_FILE)
    if not isinstance(target_owners, dict):
        target_owners = {}

    fake_targets = load_json(FAKE_TARGETS_FILE)
    if not isinstance(fake_targets, list):
        fake_targets = []

    burst_targets = load_json(BURST_TARGETS_FILE)
    if not isinstance(burst_targets, list):
        burst_targets = []

    assignments, burst_assignments, fake_assignments, summary = plan_action(
        villages, targets, disabled_coords,
        arrival_datetime=arrival_dt,
        arrival_slots=arrival_slots,
        off_speed=float(settings.get("off_speed", 18)),
        ram_speed=float(settings.get("ram_speed", 30)),
        noble_speed=float(settings.get("noble_speed", 35)),
        conflicts=conflicts,
        coord_to_player=coord_to_player,
        separations=separations,
        target_owner_map=target_owners,
        block_night_sends=bool(settings.get("block_night_sends", False)),
        off_sort=settings.get("off_sort", "closest"),
        off_sort_invert=bool(settings.get("off_sort_invert", False)),
        noble_sort=settings.get("noble_sort", "closest"),
        noble_sort_invert=bool(settings.get("noble_sort_invert", False)),
        noble_max_dist=float(settings.get("noble_max_dist", 60) or 0),
        noble_min_dist=float(settings.get("noble_min_dist", 0) or 0),
        max_off_dist=float(settings.get("max_off_dist", 0) or 0),
        min_off_dist=float(settings.get("min_off_dist", 0) or 0),
        min_off=int(settings.get("min_off", 0) or 0),
        fill_free_villages=bool(settings.get("fill_free_villages", False)),
        fake_targets=fake_targets,
        burst_targets=burst_targets,
        off_noble_gap_minutes=float(settings.get("off_noble_gap_minutes", 1)),
        player_points=player_points,
        min_morale=float(settings.get("min_morale", 100)) / 100.0,
        noble_priority_players=settings.get("noble_priority_players", []),
        arkadia_attack_range=(
            float(settings.get("arkadia_attack_range", 20))
            if settings.get("world_type") == "arkadia" else 0.0
        ),
    )
    plan_data = {
        "assignments":       assignments,
        "burst_assignments": burst_assignments,
        "fake_assignments":  fake_assignments,
        "summary":           summary,
    }
    save_json(PLAN_FILE, plan_data)
    return jsonify(plan_data)


@bp.post("/api/plan/reload-coord")
def reload_coord():
    """Replace one assigned coord with the next-best available village for that target."""
    data         = request.json or {}
    target_coord = data.get("target_coord", "")
    old_coord    = data.get("old_coord", "")
    coord_type   = data.get("type", "offs")
    blacklisted  = set(data.get("blacklisted", []))

    villages   = load_troops()
    targets_   = load_json(TARGETS_FILE)
    plan       = load_json(PLAN_FILE)
    player_map = load_json(PLAYER_MAP_FILE)
    settings   = load_settings()

    if not isinstance(plan, dict):
        return jsonify({"error": "Brak planu."}), 400

    assignments = plan.get("assignments", [])
    a_idx       = next((i for i, a in enumerate(assignments) if a["target"] == target_coord), None)
    target_data = next((t for t in targets_ if t["coord"] == target_coord), None)
    if a_idx is None or target_data is None:
        return jsonify({"error": "Cel nie znaleziony."}), 400

    disabled: set[str] = set()
    for pm in player_map:
        if not pm.get("enabled", True):
            disabled.update(pm.get("villages", []))

    used: set[str] = set()
    for i, a in enumerate(assignments):
        for c in a.get("offs", []):
            if not (i == a_idx and c == old_coord and coord_type == "offs"):
                used.add(c)
        for c in a.get("nobles", []):
            if not (i == a_idx and c == old_coord and coord_type == "nobles"):
                used.add(c)

    skip = used | blacklisted | disabled

    tx, ty      = target_data["x"], target_data["y"]
    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))

    arrival_raw = settings.get("arrival_datetime", "")
    arrival_dt: datetime | None = None
    if arrival_raw:
        try:
            arrival_dt = datetime.fromisoformat(arrival_raw)
        except ValueError:
            pass

    if coord_type == "offs":
        candidates = [v for v in villages if v["off"] > 0 and v["coord"] not in skip]
    else:
        candidates = [v for v in villages if v["nobles"] > 0 and v["coord"] not in skip]

    if not candidates:
        return jsonify({"error": "Brak dostępnych wiosek."}), 400

    def _sort_key(v):
        d = _dist(v["x"], v["y"], tx, ty)
        if coord_type == "offs":
            spd = ram_speed if v.get("rams", 0) > 0 else off_speed
        else:
            spd = noble_speed
        return (int(is_night_send(d, spd, arrival_dt)), d)

    candidates.sort(key=_sort_key)
    new_v  = candidates[0]
    dist   = round(_dist(new_v["x"], new_v["y"], tx, ty), 1)
    if coord_type == "offs":
        eff_spd = ram_speed if new_v.get("rams", 0) > 0 else off_speed
    else:
        eff_spd = noble_speed
    is_ngt = is_night_send(dist, eff_spd, arrival_dt)

    a = assignments[a_idx]
    for lst_key, detail_key in ((coord_type, coord_type + "_detail"),):
        lst    = a.get(lst_key, [])
        detail = a.get(detail_key, [])
        try:
            idx = lst.index(old_coord)
            lst[idx] = new_v["coord"]
            if idx < len(detail):
                new_detail = {"coord": new_v["coord"], "dist": dist, "is_night": is_ngt}
                if coord_type == "offs":
                    new_detail["speed"] = eff_spd
                detail[idx] = new_detail
        except ValueError:
            pass

    save_json(PLAN_FILE, plan)
    return jsonify({"assignments": assignments})


@bp.post("/api/plan/add-noble")
def add_noble():
    """Find the next best available noble village for a target and append it."""
    data         = request.json or {}
    target_coord = data.get("target_coord", "")
    blacklisted  = set(data.get("blacklisted", []))

    villages   = load_troops()
    plan       = load_json(PLAN_FILE)
    player_map = load_json(PLAYER_MAP_FILE)
    settings   = load_settings()

    if not isinstance(plan, dict):
        return jsonify({"error": "Brak planu."}), 400

    assignments = plan.get("assignments", [])
    a_idx = next((i for i, a in enumerate(assignments) if a["target"] == target_coord), None)
    if a_idx is None:
        return jsonify({"error": "Cel nie znaleziony."}), 400

    disabled: set[str] = set()
    for pm in player_map:
        if not pm.get("enabled", True):
            disabled.update(pm.get("villages", []))

    used: set[str] = set()
    for a in assignments:
        for c in a.get("offs", []):
            used.add(c)
        for c in a.get("nobles", []):
            used.add(c)

    skip = used | blacklisted | disabled

    tx_str, ty_str = target_coord.split("|")
    tx, ty = int(tx_str), int(ty_str)
    noble_speed = float(settings.get("noble_speed", 35))

    arrival_raw = settings.get("arrival_datetime", "")
    arrival_dt: datetime | None = None
    if arrival_raw:
        try:
            arrival_dt = datetime.fromisoformat(arrival_raw)
        except ValueError:
            pass

    candidates = [v for v in villages if v.get("nobles", 0) > 0 and v["coord"] not in skip]
    if not candidates:
        return jsonify({"error": "Brak dostępnych szlachciców."}), 400

    candidates.sort(key=lambda v: (
        int(is_night_send(_dist(v["x"], v["y"], tx, ty), noble_speed, arrival_dt)),
        _dist(v["x"], v["y"], tx, ty),
    ))
    new_v  = candidates[0]
    dist   = round(_dist(new_v["x"], new_v["y"], tx, ty), 1)
    is_ngt = is_night_send(dist, noble_speed, arrival_dt)

    a = assignments[a_idx]
    a.setdefault("nobles", []).append(new_v["coord"])
    a.setdefault("nobles_detail", []).append({"coord": new_v["coord"], "dist": dist, "is_night": is_ngt})
    a["nobles_needed"]  = max(a.get("nobles_needed", 0), len(a["nobles"]))
    a["nobles_missing"] = max(0, a["nobles_needed"] - len(a["nobles"]))

    save_json(PLAN_FILE, plan)
    return jsonify({"assignments": assignments})


@bp.post("/api/plan/candidates")
def get_candidates():
    """Return up to N best available villages for a given coord slot."""
    data         = request.json or {}
    target_coord = data.get("target_coord", "")
    old_coord    = data.get("old_coord", "")
    coord_type   = data.get("type", "offs")
    blacklisted  = set(data.get("blacklisted", []))
    limit        = int(data.get("limit", 500))

    villages   = load_troops()
    targets_   = load_json(TARGETS_FILE)
    plan       = load_json(PLAN_FILE)
    player_map = load_json(PLAYER_MAP_FILE)
    settings   = load_settings()

    if not isinstance(plan, dict):
        return jsonify({"candidates": []})

    # Prefer live assignments from the request body over the disk file (avoids stale-cache issues)
    assignments_override = data.get("assignments")
    assignments = assignments_override if isinstance(assignments_override, list) else plan.get("assignments", [])
    a_idx       = next((i for i, a in enumerate(assignments) if a["target"] == target_coord), None)
    target_data = next((t for t in targets_ if t["coord"] == target_coord), None)
    if a_idx is None or target_data is None:
        return jsonify({"candidates": []})

    disabled: set[str] = set()
    for pm in player_map:
        if not pm.get("enabled", True):
            disabled.update(pm.get("villages", []))

    # Only block same-type coords; off villages can still be noble candidates and vice-versa.
    used: set[str] = set()
    same_key = "offs" if coord_type == "offs" else "nobles"
    for i, a in enumerate(assignments):
        for c in a.get(same_key, []):
            if not (i == a_idx and c == old_coord):
                used.add(c)

    skip = used | blacklisted | disabled
    tx, ty = target_data["x"], target_data["y"]

    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))

    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    arrival_raw = settings.get("arrival_datetime", "")
    arrival_dt: datetime | None = None
    if arrival_raw:
        try:
            arrival_dt = datetime.fromisoformat(arrival_raw)
        except ValueError:
            pass

    if coord_type == "offs":
        cands = [v for v in villages if v["off"] > 0 and v["coord"] not in skip]
    else:
        cands = [v for v in villages if v["nobles"] > 0 and v["coord"] not in skip]

    def _spd(v):
        return (ram_speed if v.get("rams", 0) > 0 else off_speed) if coord_type == "offs" else noble_speed

    cands.sort(key=lambda v: (int(is_night_send(_dist(v["x"], v["y"], tx, ty), _spd(v), arrival_dt)),
                               _dist(v["x"], v["y"], tx, ty)))

    result = []
    for v in cands[:limit]:
        d   = round(_dist(v["x"], v["y"], tx, ty), 1)
        spd = _spd(v)
        result.append({
            "coord":      v["coord"],
            "dist":       d,
            "travel_min": round(d * spd, 1),
            "speed":      spd,
            "off":        v["off"],
            "nobles":     v["nobles"],
            "rams":       v.get("rams", 0),
            "player":     player_by_coord.get(v["coord"], ""),
            "is_night":   is_night_send(d, spd, arrival_dt),
        })
    return jsonify({"candidates": result})


@bp.post("/api/plan/swap-coord")
def swap_coord():
    """Directly replace old_coord with a chosen new_coord in the saved plan."""
    data         = request.json or {}
    target_coord = data.get("target_coord", "")
    old_coord    = data.get("old_coord", "")
    new_coord    = data.get("new_coord", "")
    coord_type   = data.get("type", "offs")

    villages = load_troops()
    targets_ = load_json(TARGETS_FILE)
    plan     = load_json(PLAN_FILE)
    settings = load_settings()

    if not isinstance(plan, dict):
        return jsonify({"error": "Brak planu."}), 400

    assignments = plan.get("assignments", [])
    a_idx       = next((i for i, a in enumerate(assignments) if a["target"] == target_coord), None)
    target_data = next((t for t in targets_ if t["coord"] == target_coord), None)
    if a_idx is None or target_data is None:
        return jsonify({"error": "Cel nie znaleziony."}), 400

    new_v = next((v for v in villages if v["coord"] == new_coord), None)
    if not new_v:
        return jsonify({"error": "Wioska nie znaleziona."}), 400

    tx, ty      = target_data["x"], target_data["y"]
    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))
    arrival_raw = settings.get("arrival_datetime", "")
    arrival_dt: datetime | None = None
    if arrival_raw:
        try:
            arrival_dt = datetime.fromisoformat(arrival_raw)
        except ValueError:
            pass

    dist = round(_dist(new_v["x"], new_v["y"], tx, ty), 1)
    if coord_type == "offs":
        eff_spd = ram_speed if new_v.get("rams", 0) > 0 else off_speed
    else:
        eff_spd = noble_speed
    is_ngt = is_night_send(dist, eff_spd, arrival_dt)

    a = assignments[a_idx]
    lst    = a.get(coord_type, [])
    detail = a.get(coord_type + "_detail", [])
    try:
        idx = lst.index(old_coord)
        lst[idx] = new_coord
        new_detail = {"coord": new_coord, "dist": dist, "is_night": is_ngt}
        if coord_type == "offs":
            new_detail["speed"] = eff_spd
        if idx < len(detail):
            detail[idx] = new_detail
    except ValueError:
        pass

    save_json(PLAN_FILE, plan)
    return jsonify({"assignments": assignments})


@bp.post("/api/plan/override")
def plan_override():
    """Save manually edited assignments back to PLAN_FILE."""
    data = request.json or {}
    assignments = data.get("assignments")
    if not isinstance(assignments, list):
        return jsonify({"error": "Nieprawidłowe dane."}), 400
    existing = load_json(PLAN_FILE)
    if not isinstance(existing, dict):
        existing = {}
    existing["assignments"] = assignments
    save_json(PLAN_FILE, existing)
    return jsonify({"ok": True})


@bp.post("/api/plan/check-troops")
def check_troops():
    """
    Re-validate the saved plan against fresh troop data.
    Replaces villages that no longer have the required troops or can no longer
    reach the target in time. Does not reshuffle the whole plan.
    Returns the updated plan plus a report of replacements and failures.
    """
    from datetime import timedelta

    SEND_BUFFER_MIN = 3  # minimum minutes left before send deadline

    plan        = load_json(PLAN_FILE)
    villages    = load_troops()
    settings    = load_settings()
    player_map  = load_json(PLAYER_MAP_FILE)
    status_map  = load_json(ATTACK_STATUS_FILE) or {}

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski."}), 400

    assignments = plan.get("assignments", [])
    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))
    now = datetime.utcnow()

    def _sid(coord: str, target: str, atype: str, idx: int) -> str:
        return f"{coord}\u2192{target}:{atype}#{idx}"

    village_by_coord: dict[str, dict] = {v["coord"]: v for v in villages}

    disabled: set[str] = set()
    for pm in player_map:
        if not pm.get("enabled", True):
            disabled.update(pm.get("villages", []))

    # Track available nobles per village (consumed as replacements are made)
    available_nobles: dict[str, int] = {v["coord"]: v.get("nobles", 0) for v in villages}

    # All coords currently booked across the whole plan
    used_off_coords:   set[str] = set()
    used_noble_coords: set[str] = set()
    for a in assignments:
        used_off_coords.update(a.get("offs", []))
        used_noble_coords.update(a.get("nobles", []))

    def _eff_speed(v: dict) -> float:
        return ram_speed if v.get("rams", 0) > 0 else off_speed

    def _can_reach(v_coord: str, tx: int, ty: int, speed: float, arrival_dt: datetime | None) -> bool:
        if arrival_dt is None:
            return True
        v = village_by_coord.get(v_coord)
        if not v:
            return False
        travel_min = _dist(v["x"], v["y"], tx, ty) * speed
        return (arrival_dt - timedelta(minutes=travel_min)) > now + timedelta(minutes=SEND_BUFFER_MIN)

    def _valid_off(coord: str) -> bool:
        v = village_by_coord.get(coord)
        if not v:
            return False
        t = v.get("troops", {})
        return t.get("axe", 0) > 0 and t.get("light", 0) > 0

    def _valid_noble(coord: str) -> bool:
        return available_nobles.get(coord, 0) > 0

    replaced:     list[dict] = []
    not_replaced: list[dict] = []

    for a in assignments:
        tcoord = a["target"]
        tx, ty = map(int, tcoord.split("|"))

        off_arrival = noble_arrival = None
        try:
            if a.get("arrival_dt"):
                off_arrival = datetime.fromisoformat(a["arrival_dt"])
            if a.get("noble_arrival_dt"):
                noble_arrival = datetime.fromisoformat(a["noble_arrival_dt"])
            elif off_arrival:
                noble_arrival = off_arrival
        except ValueError:
            pass

        # ── Check offs ─────────────────────────────────────────────────────
        _occ: dict[str, int] = {}
        for i, coord in enumerate(a.get("offs", [])):
            _occ[coord] = _occ.get(coord, -1) + 1
            # Skip attacks already sent
            if status_map.get(_sid(coord, tcoord, "OFF", _occ[coord])) == "sent":
                continue
            ok_troops = _valid_off(coord)
            ok_time   = _can_reach(coord, tx, ty, _eff_speed(village_by_coord.get(coord, {})), off_arrival)
            if ok_troops and ok_time:
                continue
            reason = "brak axe/light" if not ok_troops else "za mało czasu"

            # Build replacement candidates: not in any off assignment, has troops, reachable
            cands = sorted(
                [v for v in villages
                 if v["coord"] not in used_off_coords
                 and v["coord"] not in disabled
                 and _valid_off(v["coord"])
                 and _can_reach(v["coord"], tx, ty, _eff_speed(v), off_arrival)],
                key=lambda v: _dist(v["x"], v["y"], tx, ty),
            )
            if cands:
                new_v      = cands[0]
                new_coord  = new_v["coord"]
                used_off_coords.discard(coord)
                used_off_coords.add(new_coord)
                a["offs"][i] = new_coord
                if a.get("offs_detail") and i < len(a["offs_detail"]):
                    spd = _eff_speed(new_v)
                    d   = round(_dist(new_v["x"], new_v["y"], tx, ty), 1)
                    a["offs_detail"][i] = {"coord": new_coord, "dist": d, "speed": spd,
                                           "off": new_v["off"], "is_night": False}
                replaced.append({"target": tcoord, "type": "off", "old": coord, "new": new_coord})
            else:
                not_replaced.append({"target": tcoord, "type": "off", "coord": coord, "reason": reason})

        # ── Check nobles ───────────────────────────────────────────────────
        _nocc: dict[str, int] = {}
        for i, coord in enumerate(a.get("nobles", [])):
            _nocc[coord] = _nocc.get(coord, -1) + 1
            if status_map.get(_sid(coord, tcoord, "SZLACHCIC", _nocc[coord])) == "sent":
                continue
            ok_troops = _valid_noble(coord)
            ok_time   = _can_reach(coord, tx, ty, noble_speed, noble_arrival)
            if ok_troops and ok_time:
                continue
            reason = "brak szlachcica" if not ok_troops else "za mało czasu"

            cands = sorted(
                [v for v in villages
                 if v["coord"] not in used_noble_coords
                 and v["coord"] not in disabled
                 and available_nobles.get(v["coord"], 0) > 0
                 and _can_reach(v["coord"], tx, ty, noble_speed, noble_arrival)],
                key=lambda v: _dist(v["x"], v["y"], tx, ty),
            )
            if cands:
                new_v     = cands[0]
                new_coord = new_v["coord"]
                available_nobles[coord]     = max(0, available_nobles.get(coord, 0) - 0)  # freed
                available_nobles[new_coord] = available_nobles.get(new_coord, 0) - 1
                used_noble_coords.discard(coord)
                used_noble_coords.add(new_coord)
                a["nobles"][i] = new_coord
                if a.get("nobles_detail") and i < len(a["nobles_detail"]):
                    d = round(_dist(new_v["x"], new_v["y"], tx, ty), 1)
                    a["nobles_detail"][i] = {"coord": new_coord, "dist": d, "is_night": False}
                replaced.append({"target": tcoord, "type": "noble", "old": coord, "new": new_coord})
            else:
                not_replaced.append({"target": tcoord, "type": "noble", "coord": coord, "reason": reason})

    # Recompute missing counts
    for a in assignments:
        a["offs_missing"]   = max(0, a.get("offs_needed",   0) - len(a.get("offs",   [])))
        a["nobles_missing"] = max(0, a.get("nobles_needed", 0) - len(a.get("nobles", [])))

    plan["assignments"] = assignments
    if replaced or not_replaced:
        save_json(PLAN_FILE, plan)

    return jsonify({
        "plan":         plan,
        "replaced":     replaced,
        "not_replaced": not_replaced,
    })

