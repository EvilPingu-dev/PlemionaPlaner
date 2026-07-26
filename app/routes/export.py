"""Routes: CSV export, forum per-player export, backup/restore."""
import csv
import io
import zipfile
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from ..planner import _dist
from ..storage import (
    DATA_DIR,
    PLAN_FILE,
    PLAYER_MAP_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_troops,
    load_settings,
)

bp = Blueprint("export", __name__)


# ── CSV export ────────────────────────────────────────────────────────────────

@bp.post("/api/export/csv")
def export_csv():
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_troops()
    player_map = load_json(PLAYER_MAP_FILE)

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski."}), 400

    body = request.get_json(silent=True) or {}
    assignments = body.get("assignments") or plan.get("assignments", [])

    off_speed   = float(settings.get("off_speed",   18))
    noble_speed = float(settings.get("noble_speed", 35))

    village_by_coord = {v["coord"]: v for v in villages_d}
    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Gracz", "Z wioski", "Cel", "Typ", "Odległość", "Czas podróży (min)", "Wysyłka", "Wejście"])

    for asgn in assignments:
        tcoord   = asgn["target"]
        raw_adt  = asgn.get("arrival_dt")
        raw_ndt  = asgn.get("noble_arrival_dt") or raw_adt
        arr_dt   = datetime.fromisoformat(raw_adt)   if raw_adt else None
        noble_dt = datetime.fromisoformat(raw_ndt)   if raw_ndt else arr_dt

        def _row(coord, speed, atype, arrival_dt):
            v = village_by_coord.get(coord)
            if not v:
                return
            d          = _dist(v["x"], v["y"], *map(int, tcoord.split("|")))
            travel_min = d * speed
            send_dt    = (arrival_dt - timedelta(minutes=travel_min)) if arrival_dt else None
            writer.writerow([
                player_by_coord.get(coord, ""),
                coord, tcoord, atype,
                round(d, 2), round(travel_min, 1),
                send_dt.strftime("%Y-%m-%d %H:%M:%S") if send_dt else "",
                arrival_dt.strftime("%Y-%m-%d %H:%M:%S") if arrival_dt else "",
            ])

        for coord in asgn.get("offs", []):
            v_off = village_by_coord.get(coord)
            v_spd = ram_speed if (v_off and v_off.get("rams", 0) > 0) else off_speed
            _row(coord, v_spd, "OFF", arr_dt)
        for coord in asgn.get("nobles", []):
            _row(coord, noble_speed, "SZLACHCIC", noble_dt)

    return buf.getvalue(), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": f'attachment; filename="plan_{settings.get("action_name", "akcja")}.csv"',
    }


# ── Forum per-player BBCode export ────────────────────────────────────────────

@bp.post("/api/export/forum-players")
def export_forum_players():
    """Generate per-player forum BBCode (each player sees only their sends)."""
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    villages_d = load_troops()
    player_map = load_json(PLAYER_MAP_FILE)
    id_map     = load_json(VILLAGE_IDS_FILE) or {}

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski."}), 400

    body = request.get_json(silent=True) or {}
    assignments = body.get("assignments") or plan.get("assignments", [])

    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))
    action_name = settings.get("action_name", "Akcja")
    server      = settings.get("server", "")

    village_by_coord = {v["coord"]: v for v in villages_d}
    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    player_rows: dict[str, list[str]] = {}

    for asgn in assignments:
        tcoord   = asgn["target"]
        raw_adt  = asgn.get("arrival_dt")
        raw_ndt  = asgn.get("noble_arrival_dt") or raw_adt
        arr_dt   = datetime.fromisoformat(raw_adt) if raw_adt else None
        noble_dt = datetime.fromisoformat(raw_ndt) if raw_ndt else arr_dt

        def _add_row(coord, speed, atype, arrival_dt):
            v = village_by_coord.get(coord)
            if not v or not arrival_dt:
                return
            player     = player_by_coord.get(coord, "")
            d          = _dist(v["x"], v["y"], *map(int, tcoord.split("|")))
            travel_min = d * speed
            send_dt    = arrival_dt - timedelta(minutes=travel_min)
            from_id, tgt_id = id_map.get(coord), id_map.get(tcoord)
            link = (
                f"[url=https://pl{server}.plemiona.pl/game.php?village={from_id}&screen=place&target={tgt_id}]Wyślij[/url]"
                if from_id and tgt_id and server else "Wyślij"
            )
            color = "#3399ff" if "SZLACHCIC" in atype else "#cc6600"
            player_rows.setdefault(player, []).append(
                f"[*][coord]{coord}[/coord]"
                f"[|][color={color}][b]{atype}[/b][/color]"
                f"[|][coord]{tcoord}[/coord]"
                f"[|]{send_dt.strftime('%d.%m %H:%M:%S')}"
                f"[|]{arrival_dt.strftime('%d.%m.%Y %H:%M:%S')}"
                f"[|]{round(d, 1)} pol"
                f"[|]{link}"
            )

        for coord in asgn.get("offs", []):
            v_off = village_by_coord.get(coord)
            v_spd = ram_speed if (v_off and v_off.get("rams", 0) > 0) else off_speed
            _add_row(coord, v_spd, "OFF", arr_dt)
        for coord in asgn.get("nobles", []):
            _add_row(coord, noble_speed, "SZLACHCIC", noble_dt)

    result: list[dict] = []
    for pm in player_map:
        player = pm["player"]
        rows   = player_rows.get(player, [])
        if not rows:
            continue
        header = (
            f"[b]Akcja: {action_name}[/b]\n"
            f"[b]Gracz: [player]{player}[/player][/b]\n\n"
            "[table][**]Z wioski[||]Typ[||]Cel[||]Wysyłka[||]Wejście[||]Odl.[||]Link[/**]\n"
        )
        result.append({"player": player, "bbcode": header + "\n".join(rows) + "\n[/table]"})

    return jsonify({"players": result})


# ── Backup ────────────────────────────────────────────────────────────────────

@bp.get("/api/backup")
def backup():
    """Download all data files as a zip."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in DATA_DIR.glob("*.json"):
            zf.write(f, f.name)
        plans_dir = DATA_DIR / "plans"
        if plans_dir.exists():
            for f in plans_dir.glob("*.json"):
                zf.write(f, f"plans/{f.name}")
    buf.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return buf.read(), 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": f'attachment; filename="planer_backup_{ts}.zip"',
    }


# ── Restore ───────────────────────────────────────────────────────────────────

@bp.post("/api/restore")
def restore():
    """Restore data from uploaded zip."""
    if "file" not in request.files:
        return jsonify({"error": "Brak pliku."}), 400
    f = request.files["file"]
    try:
        with zipfile.ZipFile(f, "r") as zf:
            restored = 0
            for name in zf.namelist():
                if not name.endswith(".json"):
                    continue
                parts = name.split("/")
                if len(parts) == 1:
                    dest = DATA_DIR / parts[0]
                elif len(parts) == 2 and parts[0] == "plans":
                    dest = DATA_DIR / "plans" / parts[1]
                    dest.parent.mkdir(exist_ok=True)
                else:
                    continue
                dest.write_bytes(zf.read(name))
                restored += 1
        return jsonify({"ok": True, "restored": restored})
    except Exception as e:
        return jsonify({"error": f"Błąd przywracania: {e}"}), 400
