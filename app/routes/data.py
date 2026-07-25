"""Routes: raw data CRUD — troops, targets, fake targets, burst targets."""
from flask import Blueprint, jsonify, request

from ..fetcher import fetch_village_ids as _fetch_ids
from ..parser import parse_targets, parse_troops
from ..storage import (
    BURST_TARGETS_FILE,
    FAKE_TARGETS_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_settings,
    save_json,
)

bp = Blueprint("data", __name__)


# ── Troops ────────────────────────────────────────────────────────────────────

@bp.get("/api/troops")
def get_troops():
    return jsonify(load_json(TROOPS_FILE))


@bp.post("/api/troops")
def save_troops():
    raw = request.json.get("raw", "")
    villages = parse_troops(raw)
    save_json(TROOPS_FILE, villages)
    return jsonify({"count": len(villages), "villages": villages})


# ── Targets ───────────────────────────────────────────────────────────────────

@bp.get("/api/targets")
def get_targets():
    return jsonify(load_json(TARGETS_FILE))


@bp.post("/api/targets")
def save_targets():
    raw = request.json.get("raw", "")
    targets = parse_targets(raw)
    save_json(TARGETS_FILE, targets)
    return jsonify({"count": len(targets), "targets": targets})


# ── Fake targets ──────────────────────────────────────────────────────────────

@bp.get("/api/fake-targets")
def get_fake_targets():
    return jsonify(load_json(FAKE_TARGETS_FILE))


@bp.post("/api/fake-targets")
def save_fake_targets():
    raw = request.json.get("raw", "")
    items = []
    for ln in raw.splitlines():
        ln = ln.strip()
        if not ln or '|' not in ln:
            continue
        parts = ln.split(':')
        coord       = parts[0].strip()
        fakes       = int(parts[1]) if len(parts) > 1 and parts[1].strip().isdigit() else 0
        fake_nobles = int(parts[2]) if len(parts) > 2 and parts[2].strip().isdigit() else 0
        items.append({"coord": coord, "fakes": fakes, "fake_nobles": fake_nobles})
    save_json(FAKE_TARGETS_FILE, items)
    _try_fetch_ids([it["coord"] for it in items])
    return jsonify({"count": len(items), "items": items})


# ── Burst targets ─────────────────────────────────────────────────────────────

BUILDINGS = {
    '0': 'dowolny',
    '1': 'Ratusz', '2': 'Kuźnia', '3': 'Zagroda',
    '4': 'Tartak', '5': 'Cegielnia', '6': 'Huta Żelaza',
}


@bp.get("/api/burst-targets")
def get_burst_targets():
    items = load_json(BURST_TARGETS_FILE) or []
    # Back-fill building name in case items were saved before '0' was in BUILDINGS
    for it in items:
        if not it.get("building"):
            it["building"] = BUILDINGS.get(str(it.get("building_type", "")), "dowolny")
    return jsonify(items)


@bp.post("/api/burst-targets")
def save_burst_targets():
    raw = request.json.get("raw", "")
    items = []
    for ln in raw.splitlines():
        ln = ln.strip()
        if not ln or '|' not in ln:
            continue
        parts    = ln.split(':')
        coord    = parts[0].strip()
        attacks  = int(parts[1]) if len(parts) > 1 and parts[1].strip().isdigit() else 0
        btype    = parts[2].strip() if len(parts) > 2 else ''
        building = BUILDINGS.get(btype, '')
        items.append({"coord": coord, "attacks": attacks, "building_type": btype, "building": building})
    save_json(BURST_TARGETS_FILE, items)
    _try_fetch_ids([it["coord"] for it in items])
    return jsonify({"count": len(items), "items": items})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _try_fetch_ids(coords: list[str]) -> None:
    """Best-effort: fetch village IDs from TW for a list of coords."""
    try:
        settings = load_settings()
        if settings.get("server"):
            new_ids = _fetch_ids(settings["server"], coords)
            if new_ids:
                existing = load_json(VILLAGE_IDS_FILE) or {}
                existing.update(new_ids)
                save_json(VILLAGE_IDS_FILE, existing)
    except Exception:
        pass
