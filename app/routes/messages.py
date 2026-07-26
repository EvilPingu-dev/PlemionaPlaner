"""Routes: message generation, forum overview, named plan snapshots."""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from ..generator import generate_messages as _gen_messages
from ..plans import delete_plan, list_plans, load_plan, save_plan
from ..storage import (
    PLAN_FILE,
    PLAYER_MAP_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_settings,
    save_json,
)

bp = Blueprint("messages", __name__)


# ── Message generation ────────────────────────────────────────────────────────

@bp.post("/api/messages")
def generate_messages():
    villages   = load_json(TROOPS_FILE)
    targets    = load_json(TARGETS_FILE)
    plan       = load_json(PLAN_FILE)
    player_map = load_json(PLAYER_MAP_FILE)
    settings   = load_settings()

    body = request.get_json(silent=True) or {}
    override_asgn  = body.get("assignments")
    override_burst = body.get("burst_assignments")
    override_fake  = body.get("fake_assignments")

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski – uruchom planowanie najpierw."}), 400
    if not player_map:
        return jsonify({"error": "Brak przypisania graczy – wypełnij zakładkę Gracze."}), 400

    assignments       = override_asgn  if override_asgn  is not None else plan["assignments"]
    burst_assignments = override_burst if override_burst is not None else plan.get("burst_assignments", [])
    fake_assignments  = override_fake  if override_fake  is not None else plan.get("fake_assignments", [])

    msgs = _gen_messages(
        villages, targets, assignments, player_map, settings,
        village_id_map=load_json(VILLAGE_IDS_FILE) or {},
        burst_assignments=burst_assignments,
        fake_assignments=fake_assignments,
    )
    return jsonify({"messages": msgs})


# ── Forum overview ────────────────────────────────────────────────────────────

@bp.post("/api/forum-overview")
def forum_overview():
    plan       = load_json(PLAN_FILE)
    settings   = load_settings()
    player_map = load_json(PLAYER_MAP_FILE)

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return jsonify({"error": "Brak rozpiski – uruchom planowanie najpierw."}), 400

    player_by_coord: dict[str, str] = {}
    for pm in player_map:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    action_name = settings.get("action_name", "Akcja")
    leader      = settings.get("leader_name", "")
    arrival_raw = settings.get("arrival_datetime", "")
    arrival_str = arrival_raw[:16].replace("T", " ") if arrival_raw else "?"
    off_speed   = float(settings.get("off_speed",   18))
    ram_speed   = float(settings.get("ram_speed",   30))
    noble_speed = float(settings.get("noble_speed", 35))
    summary     = plan.get("summary", {})
    assignments = plan["assignments"]

    arrival_dt: datetime | None = None
    if arrival_raw:
        try:
            arrival_dt = datetime.fromisoformat(arrival_raw)
        except ValueError:
            pass

    def _send_str(coord: str, dist: float | None, speed: float) -> str:
        if dist is None or arrival_dt is None:
            return "?"
        send_dt = arrival_dt - timedelta(minutes=dist * speed)
        return send_dt.strftime("%d.%m %H:%M:%S")

    parts: list[str] = []

    header_lines = [f"[b]Akcja: {action_name}[/b]", f"[b]Wejście: {arrival_str}[/b]"]
    if leader:
        header_lines.append(f"[b]Dowódca: [player]{leader}[/player][/b]")
    parts.append("\n".join(header_lines))

    for a in assignments:
        status = (
            f"[color=#cc3333]Brakuje off:{a['offs_missing']} szl:{a['nobles_missing']}[/color]"
            if a["offs_missing"] > 0 or a["nobles_missing"] > 0
            else "[color=#33aa33]OK[/color]"
        )
        target_header = (
            f"[b][coord]{a['target']}[/coord]  "
            f"Offy: {len(a['offs'])}/{a['offs_needed']}  "
            f"Szlachcice: {len(a['nobles'])}/{a['nobles_needed']}  "
            f"{status}[/b]"
        )
        table_header = "[table][**]#[||]Z wioski[||]Gracz[||]Typ[||]Wysyłka[||]Cel[/**]"
        rows: list[str] = []
        row_idx = 1

        offs_detail   = a.get("offs_detail")   or [{"coord": c, "dist": None} for c in a["offs"]]
        nobles_detail = a.get("nobles_detail") or [{"coord": c, "dist": None} for c in a["nobles"]]

        for d in offs_detail:
            coord      = d["coord"]
            player_col = f"[player]{player_by_coord[coord]}[/player]" if player_by_coord.get(coord) else "-"
            night      = " 🌙" if d.get("is_night") else ""
            spd        = d.get("speed") or off_speed
            rows.append(f"[*]{row_idx}[|][coord]{coord}[/coord][|]{player_col}[|][b]OFF[/b][|]{_send_str(coord, d.get('dist'), spd)}{night}[|][coord]{a['target']}[/coord]")
            row_idx += 1

        for d in nobles_detail:
            coord      = d["coord"]
            player_col = f"[player]{player_by_coord[coord]}[/player]" if player_by_coord.get(coord) else "-"
            night      = " 🌙" if d.get("is_night") else ""
            rows.append(f"[*]{row_idx}[|][coord]{coord}[/coord][|]{player_col}[|][color=#3399ff][b]SZLACHCIC[/b][/color][|]{_send_str(coord, d.get('dist'), noble_speed)}{night}[|][coord]{a['target']}[/coord]")
            row_idx += 1

        parts.append(target_header + "\n" + table_header + "\n" + "\n".join(rows) + "\n[/table]")

    parts.append(
        f"[b]Celów:[/b] {len(assignments)} | "
        f"[b]Offów:[/b] {summary.get('offs_assigned', '?')} / {summary.get('offs_available', '?')} | "
        f"[b]Szlachciców:[/b] {summary.get('nobles_assigned', '?')} / {summary.get('nobles_available', '?')}"
    )
    return jsonify({"bbcode": "\n\n".join(parts)})


# ── Named plan snapshots ──────────────────────────────────────────────────────

@bp.get("/api/plans")
def get_plans():
    return jsonify(list_plans())


@bp.post("/api/plans/save")
def api_save_plan():
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Podaj nazwę planu."}), 400
    try:
        saved = save_plan(name)
        return jsonify({"name": saved, "plans": list_plans()})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@bp.post("/api/plans/load")
def api_load_plan():
    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Podaj nazwę planu."}), 400
    try:
        snap = load_plan(name)
        return jsonify({
            "name":       name,
            "troops":     snap.get("troops",     []),
            "targets":    snap.get("targets",    []),
            "player_map": snap.get("player_map", []),
            "settings":   snap.get("settings",   {}),
            "plan":       snap.get("plan",        {}),
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404


@bp.delete("/api/plans/<name>")
def api_delete_plan(name: str):
    delete_plan(name)
    return jsonify({"plans": list_plans()})
