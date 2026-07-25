"""Routes: attack status tracker (sent / missed / unknown per attack)."""
from flask import Blueprint, jsonify, request

from ..planner import _dist
from ..storage import (
    ATTACK_STATUS_FILE,
    PLAN_FILE,
    PLAYER_MAP_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
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


# ── Coverage post ─────────────────────────────────────────────────────────────

@bp.post("/api/attack-status/coverage")
def coverage_post():
    """
    Build a forum BBCode 'coverage needed' post for all missed attacks,
    suggesting the nearest available free villages for each.
    """
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_json(TROOPS_FILE)
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
                missed_attacks.append({
                    "coord": coord, "target": tcoord, "type": "OFF",
                    "dist": d, "player": player_by_coord.get(coord, ""),
                    "speed": off_speed, "tx": tx, "ty": ty,
                })

        for coord in asgn.get("nobles", []):
            all_assigned_coords.add(coord)
            _occ[f"{coord}:SZLACHCIC"] = _occ.get(f"{coord}:SZLACHCIC", -1) + 1
            idx = _occ[f"{coord}:SZLACHCIC"]
            if status_map.get(_status_id(coord, tcoord, "SZLACHCIC", idx)) == "missed":
                d = next((d.get("dist") for d in (asgn.get("nobles_detail") or []) if d["coord"] == coord), None)
                missed_attacks.append({
                    "coord": coord, "target": tcoord, "type": "SZLACHCIC",
                    "dist": d, "player": player_by_coord.get(coord, ""),
                    "speed": noble_speed, "tx": tx, "ty": ty,
                })

    if not missed_attacks:
        return jsonify({"bbcode": "", "missed_count": 0,
                        "message": "Brak oznaczonych jako 'missed' ataków."})

    # Separate pools — coords will be removed as they get assigned
    free_offs_set   = {v["coord"] for v in villages_d if v["off"]    > 0 and v["coord"] not in all_assigned_coords}
    free_nobles_set = {v["coord"] for v in villages_d if v["nobles"] > 0 and v["coord"] not in all_assigned_coords}
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
            # pick 3 nearest from still-available pool
            candidates = sorted(
                (village_by_c[c] for c in pool_set if c in village_by_c),
                key=lambda v: _dist(v["x"], v["y"], tx, ty)
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
