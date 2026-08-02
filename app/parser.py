import re

# Column order as emitted by the "Zbiórka wojska i obrony" PL-server script.
# After: coord (x|y), population
# Then 15 unit columns:
TROOP_COLS = [
    "spear",      # Pikinier
    "sword",      # Miecznik
    "axe",        # Topornik       ← OFF
    "archer",     # Łucznik
    "scout",      # Zwiadowca
    "light",      # Lekka Kawaleria ← OFF
    "mtd_archer", # Łucznik Konny
    "heavy",      # Ciężka Kawaleria ← OFF
    "ram",        # Taran
    "cat",        # Katapulta
    "knight",     # Rycerz
    "noble",      # Szlachcic
    "berserker",
    "trebuchet",
    "outside",    # Poza wioską
]

OFF_KEYS  = {"axe", "light", "mtd_archer", "ram"}  # primary off units
NOBLE_KEY = "noble"
CAT_KEY   = "cat"
RAM_KEY   = "ram"

# Farm-space cost per unit (zagroda)
FARM_SPACE: dict[str, int] = {
    "spear":      1,
    "sword":      1,
    "axe":        1,
    "archer":     1,
    "scout":      2,
    "light":      4,
    "mtd_archer": 5,
    "heavy":      6,
    "ram":        5,
    "cat":        8,
    "knight":     10,
    "noble":      100,
    "berserker":  1,
    "trebuchet":  8,
    "outside":    0,
}


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


def parse_troops(raw: str) -> list[dict]:
    """Parse the raw copy-paste output of the TW troops-collection script."""
    villages: list[dict] = []

    for line in raw.strip().splitlines():
        line = _strip_html(line).strip().rstrip(",")
        if not line or "|" not in line:
            continue

        parts = line.split(",")
        if len(parts) < 5:
            continue

        coord = parts[0].strip()
        try:
            x, y = map(int, coord.split("|"))
        except ValueError:
            continue

        # Population may use "." as thousands separator (e.g. "7.573")
        try:
            pop = int(parts[1].replace(".", ""))
        except ValueError:
            pop = 0

        troops: dict[str, int] = {}
        for i, key in enumerate(TROOP_COLS):
            col_idx = i + 2
            try:
                troops[key] = int(parts[col_idx]) if col_idx < len(parts) else 0
            except (ValueError, IndexError):
                troops[key] = 0

        # OFF = primary off units + cats only when village is offensive (not pure deff)
        off = sum(troops.get(k, 0) * FARM_SPACE.get(k, 1) for k in OFF_KEYS)
        if off > 0:
            off += troops.get(CAT_KEY, 0) * FARM_SPACE[CAT_KEY]

        villages.append(
            {
                "coord":  coord,
                "x":      x,
                "y":      y,
                "pop":    pop,
                "troops": troops,
                "off":    off,
                "nobles": troops.get(NOBLE_KEY, 0),
                "cats":   troops.get(CAT_KEY, 0),
                "rams":   troops.get(RAM_KEY, 0),
            }
        )

    return villages


def parse_targets(raw: str) -> list[dict]:
    """Parse targets entered manually as:  x|y:offs_needed:nobles_needed[:slot]"""
    targets: list[dict] = []

    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue

        parts = line.split(":")
        if len(parts) < 3:
            continue

        coord = parts[0].strip()
        try:
            x, y   = map(int, coord.split("|"))
            offs   = int(parts[1])
            nobles = int(parts[2])
        except ValueError:
            continue

        slot = 1
        if len(parts) >= 4:
            try:
                slot = max(1, int(parts[3]))
            except ValueError:
                slot = 1

        points = 0
        if len(parts) >= 5:
            try:
                points = max(0, int(parts[4]))
            except ValueError:
                points = 0

        targets.append(
            {
                "coord":         coord,
                "x":             x,
                "y":             y,
                "offs_needed":   offs,
                "nobles_needed": nobles,
                "arrival_slot":  slot,
                "points":        points,
            }
        )

    return targets


def parse_player_map(raw: str) -> list[dict]:
    """
    Parse player → village mapping.

    Format (one player per line):
        PlayerName: x|y, x|y, x|y
    """
    result: list[dict] = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        player, _, coords_raw = line.partition(":")
        player = player.strip()
        coords = [
            c.strip()
            for c in coords_raw.split(",")
            if c.strip() and "|" in c.strip()
        ]
        if player and coords:
            result.append({"player": player, "villages": coords})
    return result
