"""Routes: player map, village IDs, conflicts, separations."""
from flask import Blueprint, jsonify, request

from ..fetcher import fetch_all as _fetch_all
from ..parser import parse_player_map
from ..storage import (
    BURST_TARGETS_FILE,
    CONFLICTS_FILE,
    FAKE_TARGETS_FILE,
    PLAYER_MAP_FILE,
    PLAYER_POINTS_FILE,
    SEPARATIONS_FILE,
    TARGET_OWNERS_FILE,
    TARGET_POINTS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_troops,
    load_settings,
    save_json,
)

bp = Blueprint("players", __name__)


# ── Player map ────────────────────────────────────────────────────────────────

@bp.get("/api/player-map")
def get_player_map():
    return jsonify(load_json(PLAYER_MAP_FILE))


@bp.post("/api/player-map")
def save_player_map():
    raw = request.json.get("raw", "")
    existing = {pm["player"]: pm for pm in load_json(PLAYER_MAP_FILE)}
    player_map = parse_player_map(raw)
    for pm in player_map:
        prev = existing.get(pm["player"], {})
        pm["enabled"]          = prev.get("enabled", True)
        pm["show_all_attacks"] = prev.get("show_all_attacks", False)
    save_json(PLAYER_MAP_FILE, player_map)
    return jsonify({"count": len(player_map), "player_map": player_map})


@bp.post("/api/player-map/toggle")
def toggle_player():
    player = (request.json or {}).get("player", "").strip()
    if not player:
        return jsonify({"error": "Brak nazwy gracza."}), 400
    player_map = load_json(PLAYER_MAP_FILE)
    for pm in player_map:
        if pm["player"] == player:
            pm["enabled"] = not pm.get("enabled", True)
            break
    save_json(PLAYER_MAP_FILE, player_map)
    return jsonify({"player_map": player_map})


@bp.post("/api/player-map/toggle-show-all")
def toggle_show_all():
    player = (request.json or {}).get("player", "").strip()
    if not player:
        return jsonify({"error": "Brak nazwy gracza."}), 400
    player_map = load_json(PLAYER_MAP_FILE)
    for pm in player_map:
        if pm["player"] == player:
            pm["show_all_attacks"] = not pm.get("show_all_attacks", False)
            break
    save_json(PLAYER_MAP_FILE, player_map)
    return jsonify({"player_map": player_map})


@bp.post("/api/fetch-player-map")
def auto_fetch_player_map():
    """Download player→village data from the TW public map files."""
    settings = load_settings()
    server   = settings.get("server", "").strip()
    if not server:
        return jsonify({"error": "Ustaw numer serwera w zakładce ⚙ Ustawienia."}), 400

    villages = load_troops()
    if not villages:
        return jsonify({"error": "Importuj wojska najpierw (zakładka 🪖 Wojska)."}), 400

    village_coords = [v["coord"] for v in villages]
    target_coords  = list({t["coord"] for t in (load_json(BURST_TARGETS_FILE) or []) + (load_json(FAKE_TARGETS_FILE) or [])
                           if isinstance(t, dict) and t.get("coord")})
    # Also include noble targets
    from ..storage import TARGETS_FILE
    for t in (load_json(TARGETS_FILE) or []):
        if isinstance(t, dict) and t.get("coord"):
            target_coords.append(t["coord"])
    target_coords = list(set(target_coords))

    try:
        result = _fetch_all(server, village_coords, target_coords)
        existing_flags = {pm["player"]: pm for pm in load_json(PLAYER_MAP_FILE)}
        new_map = result["player_map"]
        for pm in new_map:
            prev = existing_flags.get(pm["player"], {})
            pm["enabled"]          = prev.get("enabled", True)
            pm["show_all_attacks"] = prev.get("show_all_attacks", False)
        save_json(PLAYER_MAP_FILE,    new_map)
        save_json(VILLAGE_IDS_FILE,   result["village_id_map"])
        save_json(TARGET_OWNERS_FILE, result.get("target_owner_map", {}))
        save_json(PLAYER_POINTS_FILE, result.get("player_points", {}))
        save_json(TARGET_POINTS_FILE, result.get("target_points", {}))
        # Patch targets.json with fetched points (only where not manually set)
        from ..storage import TARGETS_FILE
        targets = load_json(TARGETS_FILE) or []
        tp = result.get("target_points", {})
        for t in targets:
            if not t.get("points") and t.get("coord") in tp:
                t["points"] = tp[t["coord"]]
        save_json(TARGETS_FILE, targets)
        return jsonify({
            "count":       len(new_map),
            "player_map":  new_map,
            "village_ids": result["village_id_map"],
            "targets":     targets,
        })
    except Exception as exc:
        return jsonify({"error": f"Błąd pobierania z TW: {exc}"}), 500


@bp.get("/api/village-ids")
def get_village_ids():
    return jsonify(load_json(VILLAGE_IDS_FILE))


# ── Conflicts ─────────────────────────────────────────────────────────────────

@bp.get("/api/conflicts")
def get_conflicts():
    data = load_json(CONFLICTS_FILE)
    return jsonify(data if isinstance(data, list) else [])


@bp.post("/api/conflicts")
def save_conflicts():
    data = request.json
    if not isinstance(data, list):
        return jsonify({"error": "Expected a list."}), 400
    cleaned, seen = [], set()
    for pair in data:
        if not (isinstance(pair, list) and len(pair) == 2):
            continue
        a, b = str(pair[0]).strip(), str(pair[1]).strip()
        if not a or not b or a == b:
            continue
        key = tuple(sorted([a, b]))
        if key in seen:
            continue
        seen.add(key)
        cleaned.append([a, b])
    save_json(CONFLICTS_FILE, cleaned)
    return jsonify(cleaned)


# ── Separations ───────────────────────────────────────────────────────────────

@bp.get("/api/separations")
def get_separations():
    data = load_json(SEPARATIONS_FILE)
    return jsonify(data if isinstance(data, list) else [])


@bp.post("/api/separations")
def save_separations():
    data = request.json
    if not isinstance(data, list):
        return jsonify({"error": "Expected a list."}), 400
    cleaned, seen = [], set()
    for pair in data:
        if not (isinstance(pair, list) and len(pair) == 2):
            continue
        a, b = str(pair[0]).strip(), str(pair[1]).strip()
        if not a or not b or a == b:
            continue
        key = tuple(sorted([a, b]))
        if key in seen:
            continue
        seen.add(key)
        cleaned.append([a, b])
    save_json(SEPARATIONS_FILE, cleaned)
    return jsonify(cleaned)
