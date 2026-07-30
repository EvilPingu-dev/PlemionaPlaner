"""Routes: attack status tracker (sent / missed / unknown per attack)."""
import copy

from flask import Blueprint, jsonify, request

from ..generator import generate_messages as _gen_messages
from ..planner import _dist
from ..storage import (
    ATTACK_STATUS_FILE,
    CANCELLED_TARGETS_FILE,
    EXCLUDED_REPLACEMENTS_FILE,
    PLAN_FILE,
    PLAYER_MAP_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_troops,
    load_settings,
    save_json,
)

bp = Blueprint("status", __name__)


def _status_id(from_coord: str, target: str, atype: str, idx: int = 0) -> str:
    return f"{from_coord}→{target}:{atype}#{idx}"


# ── CRUD ──────────────────────────────────────────────────────────────────────

@bp.get("/api/attack-status")
def get_attack_status():
    return jsonify(load_json(ATTACK_STATUS_FILE) or {})


@bp.post("/api/attack-status")
def set_attack_status():
    """Body: {"updates": {"id": "sent"|"missed"|"unknown", …}}"""
    body    = request.get_json(silent=True) or {}
    updates = body.get("updates", {})
    current = load_json(ATTACK_STATUS_FILE) or {}
    for aid, st in updates.items():
        if st in ("sent", "missed", "unknown"):
            current[aid] = st
    save_json(ATTACK_STATUS_FILE, current)
    return jsonify({"ok": True, "status": current})


@bp.delete("/api/attack-status")
def reset_attack_status():
    save_json(ATTACK_STATUS_FILE, {})
    return jsonify({"ok": True})


# ── Cancelled targets ─────────────────────────────────────────────────────────

@bp.get("/api/cancelled-targets")
def get_cancelled_targets():
    data = load_json(CANCELLED_TARGETS_FILE)
    return jsonify(data if isinstance(data, list) else [])


@bp.post("/api/cancelled-targets/toggle")
def toggle_cancelled_target():
    coord = (request.json or {}).get("coord", "").strip()
    if not coord:
        return jsonify({"error": "Brak koordynatu."}), 400
    data = load_json(CANCELLED_TARGETS_FILE)
    cancelled = set(data) if isinstance(data, list) else set()
    if coord in cancelled:
        cancelled.discard(coord)
    else:
        cancelled.add(coord)
    result = sorted(cancelled)
    save_json(CANCELLED_TARGETS_FILE, result)
    return jsonify({"cancelled": result})


@bp.post("/api/cancelled-targets/message")
def cancelled_targets_message():
    """Generate a BBCode message informing players that certain targets are cancelled."""
    body        = request.get_json(silent=True) or {}
    cancelled   = set(body.get("cancelled", []))
    assignments = body.get("assignments", []) or load_json(PLAN_FILE).get("assignments", [])
    settings    = load_settings()
    player_map  = load_json(PLAYER_MAP_FILE)

    action_name = settings.get("action_name", "Akcja")

    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    # Build: cancelled_coord → set of unique players assigned there
    target_players: dict[str, set] = {}
    for asgn in assignments:
        tcoord = asgn.get("target", "")
        if tcoord not in cancelled:
            continue
        players: set[str] = set()
        for coord in asgn.get("offs", []) + asgn.get("nobles", []):
            p = player_by_coord.get(coord)
            if p:
                players.add(p)
        target_players[tcoord] = players

    if not target_players:
        return jsonify({"bbcode": "", "message": "Brak odwołanych celów lub brak przypisanych ataków."})

    lines = [
        f"[b]Akcja: {action_name} – ODWOŁANE CELE[/b]",
        "[b]Poniższe cele zostały odwołane. Nie wysyłaj ataków na te wioski![/b]",
        "",
    ]
    for tcoord, players in sorted(target_players.items()):
        player_list = ", ".join(f"[player]{p}[/player]" for p in sorted(players)) or "–"
        lines.append(f"[b]Cel: [coord]{tcoord}[/coord][/b]")
        lines.append(f"Gracze których dotyczy: {player_list}")
        lines.append("[b]NIE wysyłajcie ataków na ten cel.[/b]")
        lines.append("")

    return jsonify({"bbcode": "\n".join(lines), "cancelled_count": len(target_players)})


# ── Coverage post ─────────────────────────────────────────────────────────────

@bp.post("/api/attack-status/coverage")
def coverage_post():
    """
    Build a forum BBCode 'coverage needed' post for all missed attacks,
    suggesting the nearest available free villages for each.
    """
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_troops()
    player_map = load_json(PLAYER_MAP_FILE)
    status_map = load_json(ATTACK_STATUS_FILE) or {}
    id_map     = load_json(VILLAGE_IDS_FILE) or {}

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski."}), 400

    body        = request.get_json(silent=True) or {}
    assignments = body.get("assignments") or plan.get("assignments", [])

    off_speed   = float(settings.get("off_speed",   18))
    noble_speed = float(settings.get("noble_speed", 35))
    action_name = settings.get("action_name", "Akcja")
    server      = settings.get("server", "")
    min_off     = int(settings.get("min_off", 0))

    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    village_by_coord = {v["coord"]: v for v in villages_d}

    # Collect all assigned coords + missed attacks
    all_assigned_coords: set[str] = set()
    missed_attacks: list[dict] = []

    for asgn in assignments:
        tcoord = asgn["target"]
        tx, ty = map(int, tcoord.split("|"))
        _occ: dict[str, int] = {}

        for coord in asgn.get("offs", []):
            all_assigned_coords.add(coord)
            _occ[f"{coord}:OFF"] = _occ.get(f"{coord}:OFF", -1) + 1
            idx = _occ[f"{coord}:OFF"]
            if status_map.get(_status_id(coord, tcoord, "OFF", idx)) == "missed":
                d = next((d.get("dist") for d in (asgn.get("offs_detail") or []) if d["coord"] == coord), None)
                ov = village_by_coord.get(coord, {})
                missed_attacks.append({
                    "coord": coord, "target": tcoord, "type": "OFF",
                    "dist": d, "player": player_by_coord.get(coord, ""),
                    "speed": off_speed, "tx": tx, "ty": ty,
                    "ox": ov.get("x", tx), "oy": ov.get("y", ty),
                })

        for coord in asgn.get("nobles", []):
            all_assigned_coords.add(coord)
            _occ[f"{coord}:SZLACHCIC"] = _occ.get(f"{coord}:SZLACHCIC", -1) + 1
            idx = _occ[f"{coord}:SZLACHCIC"]
            if status_map.get(_status_id(coord, tcoord, "SZLACHCIC", idx)) == "missed":
                d = next((d.get("dist") for d in (asgn.get("nobles_detail") or []) if d["coord"] == coord), None)
                ov = village_by_coord.get(coord, {})
                missed_attacks.append({
                    "coord": coord, "target": tcoord, "type": "SZLACHCIC",
                    "dist": d, "player": player_by_coord.get(coord, ""),
                    "ox": ov.get("x", tx), "oy": ov.get("y", ty),
                    "speed": noble_speed, "tx": tx, "ty": ty,
                })

    if not missed_attacks:
        return jsonify({"bbcode": "", "missed_count": 0,
                        "message": "Brak oznaczonych jako 'missed' ataków."})

    # Separate pools — coords will be removed as they get assigned
    excluded = set(load_json(EXCLUDED_REPLACEMENTS_FILE) or [])
    disabled_coords: set[str] = {
        coord.strip()
        for pm in player_map
        if not pm.get("enabled", True)
        for coord in pm.get("villages", [])
    }
    _skip = all_assigned_coords | excluded | disabled_coords
    free_offs_set   = {v["coord"] for v in villages_d if v["off"]    >= max(min_off, 1) and v["coord"] not in _skip}
    free_nobles_set = {v["coord"] for v in villages_d if v["nobles"] > 0               and v["coord"] not in _skip}
    village_by_c    = {v["coord"]: v for v in villages_d}

    # Group missed attacks by target so we know how many each target needs
    from collections import defaultdict
    by_target: dict[str, list[dict]] = defaultdict(list)
    for ma in missed_attacks:
        by_target[ma["target"]].append(ma)

    # Sort targets: fewest missed attacks first → maximise fully-covered targets
    sorted_targets = sorted(by_target.keys(), key=lambda t: len(by_target[t]))

    parts = [
        f"[b]Akcja: {action_name} – WYMIENNIKI[/b]",
        "[b]Poniżej lista ataków, które nie zostały wysłane. Prosimy o zastępstwo![/b]",
        "[i](Kolejność: najpierw cele z najmniejszą liczbą braków – aby zdobyć jak najwięcej.)[/i]",
        "",
    ]

    for tcoord in sorted_targets:
        attacks = by_target[tcoord]
        tx, ty  = attacks[0]["tx"], attacks[0]["ty"]
        parts.append(f"[b]── Cel: [coord]{tcoord}[/coord] ({len(attacks)} brakujących ataków) ──[/b]")

        for ma in attacks:
            pool_set = free_nobles_set if ma["type"] == "SZLACHCIC" else free_offs_set
            # pick 3 nearest to the original village (= similar travel time to target)
            ox, oy = ma.get("ox", tx), ma.get("oy", ty)
            candidates = sorted(
                (village_by_c[c] for c in pool_set if c in village_by_c),
                key=lambda v: _dist(v["x"], v["y"], ox, oy)
            )[:3]

            player_tag = f"[player]{ma['player']}[/player]" if ma["player"] else "?"
            parts.append(
                f"[b]Typ: {ma['type']}  |  Oryginalna wioska: [coord]{ma['coord']}[/coord] ({player_tag})[/b]"
            )

            if candidates:
                rows = []
                for v in candidates:
                    d     = round(_dist(v["x"], v["y"], tx, ty), 1)
                    p     = player_by_coord.get(v["coord"], "")
                    pcol  = f"[player]{p}[/player]" if p else "-"
                    from_id = id_map.get(v["coord"])
                    tgt_id  = id_map.get(tcoord)
                    link = (
                        f"[url=https://pl{server}.plemiona.pl/game.php?village={from_id}&screen=place&target={tgt_id}]Wyślij[/url]"
                        if from_id and tgt_id and server else "-"
                    )
                    rows.append(f"[*][coord]{v['coord']}[/coord][|]{pcol}[|]{d} pol[|]{link}")
                parts.append(
                    "[table][**]Zastępstwo[||]Gracz[||]Odl.[||]Link[/**]\n"
                    + "\n".join(rows) + "\n[/table]"
                )
                # Remove top pick from pool so it can't be reused for another attack
                pool_set.discard(candidates[0]["coord"])
            else:
                parts.append("[color=#cc3333]Brak wolnych wiosek do zastępstwa![/color]")

        parts.append("")

    return jsonify({"bbcode": "\n".join(parts), "missed_count": len(missed_attacks)})


# ── Interactive pool ──────────────────────────────────────────────────────────

@bp.post("/api/attack-status/pool")
def attack_pool():
    """Return up to 10 nearest free village candidates for every missed attack."""
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_troops()
    player_map = load_json(PLAYER_MAP_FILE)
    status_map = load_json(ATTACK_STATUS_FILE) or {}
    id_map     = load_json(VILLAGE_IDS_FILE) or {}

    body        = request.get_json(silent=True) or {}
    assignments = body.get("assignments") or (plan.get("assignments", []) if isinstance(plan, dict) else [])
    excluded    = set(load_json(EXCLUDED_REPLACEMENTS_FILE) or [])
    server      = settings.get("server", "")
    min_off     = int(settings.get("min_off", 0))

    player_by_coord: dict[str, str] = {}
    disabled_coords: set[str] = set()
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]
            if not pm.get("enabled", True):
                disabled_coords.add(coord.strip())

    village_by_coord = {v["coord"]: v for v in villages_d}
    all_assigned:   set[str] = set()
    missed_attacks: list[dict] = []

    for asgn in assignments:
        tcoord = asgn.get("target", "")
        if not tcoord:
            continue
        tx, ty           = map(int, tcoord.split("|"))
        arrival_dt       = asgn.get("arrival_dt", "")
        noble_arrival_dt = asgn.get("noble_arrival_dt", arrival_dt)
        _occ: dict[str, int] = {}

        for coord in asgn.get("offs", []):
            all_assigned.add(coord)
            _occ[f"{coord}:OFF"] = _occ.get(f"{coord}:OFF", -1) + 1
            idx = _occ[f"{coord}:OFF"]
            sid = _status_id(coord, tcoord, "OFF", idx)
            if status_map.get(sid) == "missed":
                ov = village_by_coord.get(coord, {})
                missed_attacks.append({
                    "id": sid, "coord": coord, "target": tcoord, "type": "OFF",
                    "player": player_by_coord.get(coord, ""),
                    "tx": tx, "ty": ty,
                    "ox": ov.get("x", tx), "oy": ov.get("y", ty),
                    "arrival_dt": arrival_dt,
                })

        for coord in asgn.get("nobles", []):
            all_assigned.add(coord)
            _occ[f"{coord}:SZLACHCIC"] = _occ.get(f"{coord}:SZLACHCIC", -1) + 1
            idx = _occ[f"{coord}:SZLACHCIC"]
            sid = _status_id(coord, tcoord, "SZLACHCIC", idx)
            if status_map.get(sid) == "missed":
                ov = village_by_coord.get(coord, {})
                missed_attacks.append({
                    "id": sid, "coord": coord, "target": tcoord, "type": "SZLACHCIC",
                    "player": player_by_coord.get(coord, ""),
                    "tx": tx, "ty": ty,
                    "ox": ov.get("x", tx), "oy": ov.get("y", ty),
                    "arrival_dt": noble_arrival_dt or arrival_dt,
                })

    _skip       = all_assigned | excluded | disabled_coords
    free_offs   = {v["coord"]: v for v in villages_d
                   if v["off"]    >= max(min_off, 1) and v["coord"] not in _skip}
    free_nobles = {v["coord"]: v for v in villages_d
                   if v["nobles"] > 0               and v["coord"] not in _skip}

    result = []
    for ma in missed_attacks:
        pool = free_nobles if ma["type"] == "SZLACHCIC" else free_offs
        ox, oy = ma.get("ox", ma["tx"]), ma.get("oy", ma["ty"])
        candidates = sorted(pool.values(), key=lambda v: _dist(v["x"], v["y"], ox, oy))[:10]
        result.append({
            "id":         ma["id"],
            "coord":      ma["coord"],
            "target":     ma["target"],
            "type":       ma["type"],
            "player":     ma["player"],
            "arrival_dt": ma["arrival_dt"],
            "candidates": [
                {
                    "coord":     v["coord"],
                    "player":    player_by_coord.get(v["coord"], ""),
                    "off":       v["off"],
                    "nobles":    v.get("nobles", 0),
                    "dist":      round(_dist(v["x"], v["y"], ma["tx"], ma["ty"]), 1),
                    "from_id":   id_map.get(v["coord"]),
                    "target_id": id_map.get(ma["target"]),
                }
                for v in candidates
            ],
        })

    return jsonify({"missed_attacks": result, "server": server})


@bp.post("/api/attack-status/replacement-message")
def replacement_message():
    """
    Generate the full BBCode message for a picked replacement village.
    Includes all existing sends for that player + the new replacement send.
    """
    body              = request.get_json(silent=True) or {}
    replacement_coord = body.get("replacement_coord", "").strip()
    missed_target     = body.get("target", "").strip()
    missed_type       = body.get("type", "OFF").strip()
    arrival_dt        = body.get("arrival_dt", "")
    assignments_in    = body.get("assignments")

    if not replacement_coord or not missed_target:
        return jsonify({"error": "Brak danych."}), 400

    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_troops()
    targets    = load_json(TARGETS_FILE)
    player_map = load_json(PLAYER_MAP_FILE)
    id_map     = load_json(VILLAGE_IDS_FILE) or {}

    base_asgn = assignments_in if assignments_in is not None else (
        plan.get("assignments", []) if isinstance(plan, dict) else []
    )

    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    replacement_player = player_by_coord.get(replacement_coord, "")

    modified = copy.deepcopy(base_asgn)

    # Add the replacement village to the existing assignment for that target
    target_asgn = next((a for a in modified if a.get("target") == missed_target), None)
    if target_asgn is None:
        target_asgn = {
            "target": missed_target,
            "offs": [], "nobles": [],
            "arrival_dt": arrival_dt,
            "noble_arrival_dt": arrival_dt,
        }
        modified.append(target_asgn)

    if missed_type == "SZLACHCIC":
        target_asgn.setdefault("nobles", []).append(replacement_coord)
        if arrival_dt and not target_asgn.get("noble_arrival_dt"):
            target_asgn["noble_arrival_dt"] = arrival_dt
    else:
        target_asgn.setdefault("offs", []).append(replacement_coord)
        if arrival_dt and not target_asgn.get("arrival_dt"):
            target_asgn["arrival_dt"] = arrival_dt

    msgs = _gen_messages(
        villages_d, targets, modified, player_map, settings,
        village_id_map=id_map,
    )

    msg = next((m for m in msgs if m["player"] == replacement_player), None)
    if not msg:
        return jsonify({"error": f"Brak wiadomości dla gracza '{replacement_player}'."}), 404

    return jsonify({
        "player":    replacement_player,
        "message":   msg["message"],
        "mail_link": msg.get("mail_link", ""),
        "attacks":   msg.get("attacks", []),
    })


@bp.post("/api/attack-status/save-replacement")
def save_replacement():
    """
    Append a replacement coord to plan.json non-destructively.
    The original missed coord stays; the replacement is added as an extra send.
    """
    body              = request.get_json(silent=True) or {}
    replacement_coord = body.get("replacement_coord", "").strip()
    missed_target     = body.get("target", "").strip()
    missed_type       = body.get("type", "OFF").strip()
    arrival_dt        = body.get("arrival_dt", "")

    if not replacement_coord or not missed_target:
        return jsonify({"error": "Brak danych."}), 400

    plan = load_json(PLAN_FILE)
    if not isinstance(plan, dict):
        return jsonify({"error": "Brak planu."}), 400

    assignments = plan.get("assignments", [])
    target_asgn = next((a for a in assignments if a.get("target") == missed_target), None)
    if target_asgn is None:
        target_asgn = {
            "target": missed_target,
            "offs": [], "nobles": [],
            "arrival_dt": arrival_dt,
            "noble_arrival_dt": arrival_dt,
        }
        assignments.append(target_asgn)
        plan["assignments"] = assignments

    if missed_type == "SZLACHCIC":
        target_asgn.setdefault("nobles", []).append(replacement_coord)
        if arrival_dt and not target_asgn.get("noble_arrival_dt"):
            target_asgn["noble_arrival_dt"] = arrival_dt
    else:
        target_asgn.setdefault("offs", []).append(replacement_coord)
        if arrival_dt and not target_asgn.get("arrival_dt"):
            target_asgn["arrival_dt"] = arrival_dt

    save_json(PLAN_FILE, plan)
    return jsonify({"ok": True, "target": missed_target, "type": missed_type, "coord": replacement_coord})
