import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

TROOPS_FILE       = DATA_DIR / "troops.json"
TARGETS_FILE      = DATA_DIR / "targets.json"
PLAN_FILE         = DATA_DIR / "plan.json"
PLAYER_MAP_FILE   = DATA_DIR / "player_map.json"
SETTINGS_FILE     = DATA_DIR / "settings.json"
VILLAGE_IDS_FILE  = DATA_DIR / "village_ids.json"     # {coord: tw_village_id}
CONFLICTS_FILE    = DATA_DIR / "conflicts.json"       # [[playerA, playerB], ...]  shared IP
SEPARATIONS_FILE  = DATA_DIR / "separations.json"     # [[playerA, playerB], ...]  can't share enemy player
TARGET_OWNERS_FILE = DATA_DIR / "target_owners.json"  # {target_coord: enemy_player_name}
FAKE_TARGETS_FILE  = DATA_DIR / "fake_targets.json"   # ["x|y", ...]
BURST_TARGETS_FILE = DATA_DIR / "burst_targets.json"  # [{"coord": "x|y", "building": "..."}, ...]
ATTACK_STATUS_FILE = DATA_DIR / "attack_status.json"  # {"id": "sent"|"missed"|"unknown", …}

DEFAULT_SETTINGS: dict = {
    "action_name":             "Akcja",
    "arrival_datetime":        "",      # kept for backwards compat = slot 1
    "arrival_slots":           [],      # [{label, datetime}, …] – overrides arrival_datetime when set
    "arrival_window_minutes":  1,
    "off_noble_gap_minutes":   1,      # minutes between off arrival and first noble arrival
    "server":                  "230",
    "leader_name":             "",
    "off_speed":               18,
    "noble_speed":             35,
    # Planner behaviour
    "block_night_sends":       False,   # True = hard exclude night sends
    "off_sort":                "closest",  # closest | farthest | strongest
    "off_sort_invert":         False,   # reverse the off sort order
    "noble_sort":              "closest",  # closest | farthest | strongest
    "noble_sort_invert":       False,   # reverse the noble sort order
    "noble_max_dist":          60,     # max fields for nobles (0 = unlimited)
    "noble_min_dist":          0,      # min fields for nobles (0 = no minimum)
    "max_off_dist":            0,      # max fields for offs   (0 = unlimited)
    "min_off_dist":            0,      # min fields for offs   (0 = no minimum)
    "fill_free_villages":      False,  # fill missing offs from unassigned villages
    "greeting": (
        "Witam,\n"
        "poniżej są wasze cele, proszę zapoznać się z treścią.\n"
        "W razie pytań lub problemów (lub jakichkolwiek wątpliwości) "
        "proszę o zgłoszenie mi tego.\n\n"
        "W razie, gdyby nie było możliwości wysyłki, lub coś się nie udało, "
        "to proszę jak najszybciej dać mi znać, bym mógł dopracować akcje.\n\n"
        "Na czas akcji komendy obowiązkowe dla mnie i całego plemienia."
    ),
}


def load_json(path: Path) -> list | dict:
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []
    return []


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                saved = json.load(f)
            return {**DEFAULT_SETTINGS, **saved}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULT_SETTINGS)
