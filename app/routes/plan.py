"""Routes: plan execution, settings, plan edit helpers."""
from datetime import datetime

from flask import Blueprint, jsonify, request

from ..planner import _dist, is_night_send, plan_action
from ..storage import (
    BURST_TARGETS_FILE,
    CONFLICTS_FILE,
    FAKE_TARGETS_FILE,
    PLAN_FILE,
    PLAYER_MAP_FILE,
    SEPARATIONS_FILE,
    SETTINGS_FILE,
    TARGET_OWNERS_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
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
    villages = load_json(TROOPS_FILE)
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
        fill_free_villages=bool(settings.get("fill_free_villages", False)),
        fake_targets=fake_targets,
        burst_targets=burst_targets,
        off_noble_gap_minutes=float(settings.get("off_noble_gap_minutes", 1)),
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

    villages   = load_json(TROOPS_FILE)
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
    noble_speed = float(settings.get("noble_speed", 35))
    speed       = off_speed if coord_type == "offs" else noble_speed

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
        return (int(is_night_send(d, speed, arrival_dt)), d)

    candidates.sort(key=_sort_key)
    new_v  = candidates[0]
    dist   = round(_dist(new_v["x"], new_v["y"], tx, ty), 1)
    is_ngt = is_night_send(dist, speed, arrival_dt)

    a = assignments[a_idx]
    for lst_key, detail_key in ((coord_type, coord_type + "_detail"),):
        lst    = a.get(lst_key, [])
        detail = a.get(detail_key, [])
        try:
            idx = lst.index(old_coord)
            lst[idx] = new_v["coord"]
            if idx < len(detail):
                detail[idx] = {"coord": new_v["coord"], "dist": dist, "is_night": is_ngt}
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
