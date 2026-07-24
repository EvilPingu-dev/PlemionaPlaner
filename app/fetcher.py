"""
Fetches player→village mapping and village ID data from TW public map files.

TW exposes these public (no auth) CSV files per server:
  https://plXXX.plemiona.pl/map/village.txt  → id,name,x,y,player_id,points,type
  https://plXXX.plemiona.pl/map/player.txt   → id,name,tribe_id,village_count,points,rank

Names are URL-encoded (+ = space).
"""
import urllib.parse
import urllib.request


def _fetch(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (PlemionaPlaner/1.0)"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8")


def fetch_all(server: str, village_coords: list[str], target_coords: list[str]) -> dict:
    """
    Download village + player data and return a dict with:
      - player_map:     [{player, villages:[coord,…]}, …]  (filtered to village_coords)
      - village_id_map: {coord: village_id}  (for ALL coords: troops + targets)

    Parameters
    ----------
    server          TW server number, e.g. "230"
    village_coords  "x|y" strings from imported troops (our tribe's villages)
    target_coords   "x|y" strings of enemy targets
    """
    base = f"https://pl{server}.plemiona.pl/map"

    raw_villages = _fetch(f"{base}/village.txt")
    raw_players  = _fetch(f"{base}/player.txt")

    # id → player name
    player_names: dict[str, str] = {}
    for line in raw_players.splitlines():
        parts = line.split(",")
        if len(parts) >= 2:
            pid  = parts[0].strip()
            name = urllib.parse.unquote_plus(parts[1].strip())
            player_names[pid] = name

    all_relevant = set(village_coords) | set(target_coords)

    player_villages: dict[str, list[str]] = {}
    village_id_map:  dict[str, str]       = {}
    target_owner_map: dict[str, str]      = {}   # target coord → enemy player name

    target_set  = set(target_coords)
    village_set = set(village_coords)

    for line in raw_villages.splitlines():
        parts = line.split(",")
        if len(parts) < 5:
            continue
        vid, x, y, pid = parts[0].strip(), parts[2].strip(), parts[3].strip(), parts[4].strip()
        coord = f"{x}|{y}"

        if coord in all_relevant:
            village_id_map[coord] = vid

        # Build player map for our own villages
        if coord in village_set and pid and pid != "0":
            player_villages.setdefault(pid, []).append(coord)

        # Record enemy owner for target villages
        if coord in target_set and pid and pid != "0":
            target_owner_map[coord] = player_names.get(pid, f"Gracz_{pid}")

    player_map = sorted(
        [
            {"player": player_names.get(pid, f"Gracz_{pid}"), "villages": sorted(coords)}
            for pid, coords in player_villages.items()
        ],
        key=lambda p: p["player"].casefold(),
    )

    return {"player_map": player_map, "village_id_map": village_id_map, "target_owner_map": target_owner_map}


# Backwards-compatible wrapper used by existing code
def fetch_player_map(server: str, village_coords: list[str]) -> list[dict]:
    return fetch_all(server, village_coords, [])["player_map"]


def fetch_village_ids(server: str, coords: list[str]) -> dict[str, str]:
    """Lightweight fetch: return {coord: village_id} for the given coords only."""
    if not coords or not server:
        return {}
    base = f"https://pl{server}.plemiona.pl/map"
    raw  = _fetch(f"{base}/village.txt")
    need = set(coords)
    result: dict[str, str] = {}
    for line in raw.splitlines():
        parts = line.split(",")
        if len(parts) < 4:
            continue
        vid, x, y = parts[0].strip(), parts[2].strip(), parts[3].strip()
        coord = f"{x}|{y}"
        if coord in need:
            result[coord] = vid
            if len(result) == len(need):
                break
    return result
