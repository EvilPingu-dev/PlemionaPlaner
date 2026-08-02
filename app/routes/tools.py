"""Routes: timeline, validation, world-config."""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from ..planner import _dist, is_night_send
from ..storage import (
    PLAN_FILE,
    PLAYER_MAP_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_troops,
    load_settings,
)

bp = Blueprint("tools", __name__)


# ── Timeline ──────────────────────────────────────────────────────────────────

@bp.post("/api/timeline")
def get_timeline():
    """Return all planned sends sorted by send time for timeline view."""
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_troops()
    player_map = load_json(PLAYER_MAP_FILE)

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski."}), 400

    body = request.get_json(silent=True) or {}
    assignments       = body.get("assignments")       or plan.get("assignments", [])
    burst_assignments = body.get("burst_assignments") or plan.get("burst_assignments", [])
    fake_assignments  = body.get("fake_assignments")  or plan.get("fake_assignments", [])

    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))
    server      = settings.get("server", "")

    village_by_coord = {v["coord"]: v for v in villages_d}
    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    id_map = load_json(VILLAGE_IDS_FILE) or {}
    sends: list[dict] = []

    def _add_send(coord, speed, atype, arrival_dt, target):
        v = village_by_coord.get(coord)
        if not v:
            return
        d          = _dist(v["x"], v["y"], *map(int, target.split("|")))
        travel_min = d * speed
        send_dt    = arrival_dt - timedelta(minutes=travel_min)
        sends.append({
            "player":     player_by_coord.get(coord, ""),
            "from_coord": coord,
            "target":     target,
            "type":       atype,
            "send_dt":    send_dt.isoformat(),
            "arrival_dt": arrival_dt.isoformat(),
            "travel_min": round(travel_min, 1),
            "dist":       round(d, 2),
            "off":        v.get("off", 0),
            "is_night":   is_night_send(d, speed, arrival_dt),
            "from_id":    id_map.get(coord),
            "target_id":  id_map.get(target),
            "server":     server,
        })

    for asgn in assignments:
        tcoord  = asgn["target"]
        raw_adt = asgn.get("arrival_dt")
        raw_ndt = asgn.get("noble_arrival_dt") or raw_adt
        if not raw_adt:
            continue
        arr_dt   = datetime.fromisoformat(raw_adt)
        noble_dt = datetime.fromisoformat(raw_ndt) if raw_ndt else arr_dt
        for coord in asgn.get("offs", []):
            v_off = village_by_coord.get(coord)
            v_spd = ram_speed if (v_off and v_off.get("rams", 0) > 0) else off_speed
            _add_send(coord, v_spd, "OFF", arr_dt, tcoord)
        for coord in asgn.get("nobles", []):
            _add_send(coord, noble_speed, "SZLACHCIC", noble_dt, tcoord)

    for asgn in burst_assignments:
        tcoord  = asgn["target"]
        raw_adt = asgn.get("arrival_dt")
        if not raw_adt:
            continue
        arr_dt = datetime.fromisoformat(raw_adt)
        for coord in asgn.get("catapults", []):
            _add_send(coord, 30.0, "BURZAK", arr_dt, tcoord)

    for asgn in fake_assignments:
        tcoord  = asgn["target"]
        raw_adt = asgn.get("arrival_dt")
        if not raw_adt:
            continue
        arr_dt = datetime.fromisoformat(raw_adt)
        for coord in asgn.get("fake_offs", []):
            _add_send(coord, off_speed, "FEJK", arr_dt, tcoord)

    sends.sort(key=lambda s: s["send_dt"])

    by_player: dict[str, list] = {}
    for s in sends:
        by_player.setdefault(s["player"] or "?", []).append(s)

    # Flag same-player near-simultaneous sends to different targets
    for player_sends in by_player.values():
        for i, s in enumerate(player_sends):
            for j, t in enumerate(player_sends):
                if i >= j:
                    continue
                dt_diff = abs(
                    datetime.fromisoformat(s["send_dt"]) - datetime.fromisoformat(t["send_dt"])
                ).total_seconds()
                if dt_diff < 30 and s["target"] != t["target"]:
                    s["conflict"] = True
                    t["conflict"] = True

    return jsonify({"sends": sends, "by_player": by_player})


# ── Validate plan ─────────────────────────────────────────────────────────────

@bp.post("/api/validate")
def validate_plan():
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    player_map = load_json(PLAYER_MAP_FILE)

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski."}), 400

    body = request.get_json(silent=True) or {}
    assignments = body.get("assignments") or plan.get("assignments", [])

    noble_speed = float(settings.get("noble_speed", 35))
    issues: list[dict] = []

    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    all_assigned: dict[str, list[str]] = {}
    player_targets: dict[str, dict[str, int]] = {}

    for asgn in assignments:
        tcoord  = asgn["target"]
        raw_adt = asgn.get("arrival_dt")
        raw_ndt = asgn.get("noble_arrival_dt") or raw_adt

        for coord in asgn.get("offs", []) + asgn.get("nobles", []):
            all_assigned.setdefault(coord, []).append(tcoord)

        if raw_adt and raw_ndt:
            arr_dt   = datetime.fromisoformat(raw_adt)
            noble_dt = datetime.fromisoformat(raw_ndt)

            nobles_detail = asgn.get("nobles_detail") or [{"coord": c, "dist": None} for c in asgn.get("nobles", [])]

            if asgn.get("offs_detail") and nobles_detail:
                if noble_dt <= arr_dt:
                    issues.append({
                        "type":     "noble_before_off",
                        "target":   tcoord,
                        "message":  f"Szlachcice wchodzą PRZED lub równo z offami! OFF: {arr_dt.strftime('%H:%M:%S')}, Szlachcic: {noble_dt.strftime('%H:%M:%S')}",
                        "severity": "error",
                    })

            if len(nobles_detail) >= 2:
                noble_send_times: list[datetime] = []
                for d in nobles_detail:
                    if d.get("dist") is not None:
                        noble_send_times.append(noble_dt - timedelta(minutes=d["dist"] * noble_speed))
                if noble_send_times:
                    spread = (max(noble_send_times) - min(noble_send_times)).total_seconds()
                    if spread > 120:
                        issues.append({
                            "type":     "noble_spread",
                            "target":   tcoord,
                            "message":  f"Szlachcice wysyłane z rozpiętością {int(spread)}s – mogą nie trafić jako train.",
                            "severity": "warn",
                        })

        for coord in asgn.get("offs", []) + asgn.get("nobles", []):
            player = player_by_coord.get(coord)
            if player:
                player_targets.setdefault(player, {}).setdefault(tcoord, 0)
                player_targets[player][tcoord] += 1

    for coord, targets_list in all_assigned.items():
        if len(targets_list) > 1:
            issues.append({
                "type":     "duplicate_village",
                "target":   coord,
                "message":  f"Wioska {coord} przypisana do {len(targets_list)} celów: {', '.join(targets_list)}",
                "severity": "error",
            })

    for player, target_counts in player_targets.items():
        for tcoord, count in target_counts.items():
            if count >= 3:
                issues.append({
                    "type":     "overstack",
                    "target":   tcoord,
                    "message":  f"Gracz [b]{player}[/b] wysyła {count} ataki na {tcoord} – możliwy overstack!",
                    "severity": "warn",
                })

    return jsonify({"issues": issues, "ok": len(issues) == 0})


# ── World config auto-fetch ───────────────────────────────────────────────────

@bp.get("/api/world-config")
def get_world_config():
    """Fetch unit speeds from TW public interface.php."""
    import urllib.request
    import xml.etree.ElementTree as ET

    settings = load_settings()
    server   = settings.get("server", "")
    if not server:
        return jsonify({"error": "Brak numeru serwera w Ustawieniach."}), 400

    try:
        url = f"https://pl{server}.plemiona.pl/interface.php?func=get_unit_info"
        with urllib.request.urlopen(url, timeout=6) as resp:
            xml_data = resp.read().decode("utf-8")
        root = ET.fromstring(xml_data)
        name_map = {
            "axe": "axe", "heavy": "heavy", "knight": "knight",
            "noble": "noble", "ram": "ram", "spy": "scout",
            "sword": "sword", "spear": "spear", "archer": "archer",
            "light": "light", "marcher": "mtd_archer", "catapult": "cat",
        }
        speeds: dict[str, float] = {}
        for unit in root:
            speed_el = unit.find("speed")
            if speed_el is not None:
                try:
                    speeds[name_map.get(unit.tag, unit.tag)] = float(speed_el.text)
                except (ValueError, TypeError):
                    pass
        return jsonify({
            "speeds":      speeds,
            "off_speed":   speeds.get("axe", 18),
            "noble_speed": speeds.get("noble", 35),
            "cat_speed":   speeds.get("cat", 30),
        })
    except Exception as e:
        return jsonify({"error": f"Błąd pobierania: {e}"}), 500
