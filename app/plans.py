"""
Named plan persistence.
Each plan is saved as a single JSON snapshot in data/plans/{safe_name}.json
containing all sub-data: troops, targets, player_map, settings, plan, village_ids.
"""
import re

from .storage import (
    DATA_DIR,
    PLAN_FILE,
    PLAYER_MAP_FILE,
    SETTINGS_FILE,
    TARGETS_FILE,
    TROOPS_FILE,
    VILLAGE_IDS_FILE,
    load_json,
    load_settings,
    save_json,
)

PLANS_DIR = DATA_DIR / "plans"
PLANS_DIR.mkdir(exist_ok=True)


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-\. ]", "", name).strip()[:60]


def list_plans() -> list[str]:
    return sorted(p.stem for p in PLANS_DIR.glob("*.json"))


def save_plan(name: str) -> str:
    """Snapshot all current data files into one named plan JSON."""
    safe = _safe_name(name)
    if not safe:
        raise ValueError("Nieprawidłowa nazwa planu.")

    snapshot = {
        "name":        safe,
        "troops":      load_json(TROOPS_FILE),
        "targets":     load_json(TARGETS_FILE),
        "player_map":  load_json(PLAYER_MAP_FILE),
        "village_ids": load_json(VILLAGE_IDS_FILE),
        "settings":    load_settings(),
        "plan":        load_json(PLAN_FILE),
    }
    save_json(PLANS_DIR / f"{safe}.json", snapshot)
    return safe


def load_plan(name: str) -> dict:
    """Restore a named plan snapshot into all current data files."""
    safe = _safe_name(name)
    path = PLANS_DIR / f"{safe}.json"
    if not path.exists():
        raise FileNotFoundError(f"Plan '{safe}' nie istnieje.")

    snap = load_json(path)
    save_json(TROOPS_FILE,      snap.get("troops",      []))
    save_json(TARGETS_FILE,     snap.get("targets",     []))
    save_json(PLAYER_MAP_FILE,  snap.get("player_map",  []))
    save_json(VILLAGE_IDS_FILE, snap.get("village_ids", {}))
    save_json(SETTINGS_FILE,    snap.get("settings",    {}))
    save_json(PLAN_FILE,        snap.get("plan",        {}))
    return snap


def delete_plan(name: str) -> None:
    safe = _safe_name(name)
    path = PLANS_DIR / f"{safe}.json"
    if path.exists():
        path.unlink()
