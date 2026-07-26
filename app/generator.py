"""
BBCode message generation for Tribal Wars attack planning.
Calculates travel times and generates per-player messages + TW links.
"""
import math
import urllib.parse
from datetime import datetime, timedelta

# Travel speed in MINUTES per field (Euclidean distance unit)
# PL server values
UNIT_SPEED: dict[str, float] = {
    "spear":      18,
    "sword":      22,
    "axe":        18,
    "archer":     18,
    "scout":       9,
    "light":      10,
    "mtd_archer": 10,
    "heavy":      11,
    "ram":        30,
    "cat":        30,
    "knight":     10,
    "noble":      35,
}


def euclidean(x1: int, y1: int, x2: int, y2: int) -> float:
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)


def _fmt_window(dt_start: datetime, window_min: int) -> str:
    """Return TW BBCode for a time window (start + window_min minutes)."""
    dt_end = dt_start + timedelta(minutes=window_min)
    d1 = dt_start.strftime("%Y-%m-%d")
    d2 = dt_end.strftime("%Y-%m-%d")
    t1 = dt_start.strftime("%H:%M:%S")
    t2 = dt_end.strftime("%H:%M:%S")
    if d1 == d2:
        return f"{d1}\n[b][color=#0e5e5e]{t1}[/color][/b]-[b][color=#ff0000]{t2}[/color][/b]"
    return (
        f"{d1} [b][color=#0e5e5e]{t1}[/color][/b]"
        f"-{d2} [b][color=#ff0000]{t2}[/color][/b]"
    )


def _attack_link(server: str, from_id: str | None, target_id: str | None, label: str) -> str:
    """BBCode [url=…]label[/url] for the attack send button, or plain label if IDs missing."""
    if from_id and target_id and server:
        url = (
            f"https://pl{server}.plemiona.pl/game.php"
            f"?village={from_id}&screen=place&target={target_id}"
        )
        return f"[url={url}]{label}[/url]"
    return label


def _mail_link(server: str, player: str, subject: str, message: str) -> str:
    """
    TW in-game mail composer URL.
    Format: .../game.php?screen=mail&mode=new#to=NAME&subject=ENC&message=ENC
    Note: params after # are fragment params (not query params) as TW uses them.
    """
    if not server:
        return ""
    frag = urllib.parse.urlencode(
        {"to": player, "subject": subject, "message": message},
        quote_via=urllib.parse.quote,
    )
    return f"https://pl{server}.plemiona.pl/game.php?screen=mail&mode=new#{frag}"


def generate_messages(
    villages: list,
    targets: list,
    assignments: list,
    player_map: list,
    settings: dict,
    village_id_map: dict | None = None,
    burst_assignments: list | None = None,
    fake_assignments: list | None = None,
) -> list[dict]:
    """
    Return a list of {player, message, mail_link, attacks} dicts.

    Parameters
    ----------
    villages        Parsed troop data  (troops.json)
    targets         Parsed target list (targets.json)
    assignments     Planner output     (plan.json → assignments)
    player_map      [{player, villages:[coord,…]}, …]
    settings        Action settings dict
    village_id_map  {coord: tw_village_id}  (optional – needed for links)
    """
    village_by_coord = {v["coord"]: v for v in villages}
    target_by_coord  = {t["coord"]: t for t in targets}
    id_map           = village_id_map or {}

    player_by_village: dict[str, str] = {}
    for pm in player_map:
        for coord in pm["villages"]:
            player_by_village[coord.strip()] = pm["player"]

    arrival_dt_default = datetime.fromisoformat(settings["arrival_datetime"]) if settings.get("arrival_datetime") else None
    window_min   = int(settings.get("arrival_window_minutes", 1))
    off_speed        = float(settings.get("off_speed", 18))
    ram_speed        = float(settings.get("ram_speed", 30))
    noble_speed      = float(settings.get("noble_speed", 35))
    noble_escort_min = int(settings.get("noble_escort_min", 100))
    greeting     = settings.get("greeting", "")
    leader       = settings.get("leader_name", "")
    server       = settings.get("server", "")
    action_name  = settings.get("action_name", "Akcja")
    arrival_dt_fmt = arrival_dt_default.strftime("%d.%m.%Y") if arrival_dt_default else ""

    # Pre-scan: for each village count how many nobles it sends and whether it
    # also appears as an OFF sender.  When a village does both, its troops must
    # be split: each noble gets `noble_escort_min` escort; the OFF gets the rest.
    _village_noble_count: dict[str, int] = {}
    _village_is_off: set[str] = set()
    for asgn in assignments:
        for coord in asgn.get("offs", []):
            _village_is_off.add(coord)
        for coord in asgn.get("nobles", []):
            _village_noble_count[coord] = _village_noble_count.get(coord, 0) + 1

    player_attacks: dict[str, list] = {}

    for asgn in assignments:
        tcoord = asgn["target"]
        tgt = target_by_coord.get(tcoord)
        if not tgt:
            continue
        tx, ty  = tgt["x"], tgt["y"]
        t_id    = id_map.get(tcoord)
        # Use per-target arrival datetime stored by planner, fallback to settings default
        raw_tdt = asgn.get("arrival_dt")
        arrival_dt = datetime.fromisoformat(raw_tdt) if raw_tdt else arrival_dt_default
        if not arrival_dt:
            continue
        raw_ndt = asgn.get("noble_arrival_dt")
        noble_arrival_dt = datetime.fromisoformat(raw_ndt) if raw_ndt else arrival_dt
        arrival_str       = _fmt_window(arrival_dt, window_min)
        noble_arrival_str = _fmt_window(noble_arrival_dt, window_min)

        def _add(coord: str, atype: str, speed: float, noble_cnt: int = 0,
                 _tx=tx, _ty=ty, _tcoord=tcoord, _t_id=t_id,
                 _arr_dt=arrival_dt, _arr_str=arrival_str):
            v = village_by_coord.get(coord)
            if not v:
                return
            player     = player_by_village.get(coord, "Nieprzypisany")
            d          = euclidean(v["x"], v["y"], _tx, _ty)
            travel_min = d * speed
            send_dt    = _arr_dt - timedelta(minutes=travel_min)
            cats       = v.get("cats", 0)
            from_id    = id_map.get(coord)
            label      = f"Wyślij {atype}"
            link       = _attack_link(server, from_id, _t_id, label)

            # Determine effective OFF count for this attack row.
            # When the village sends both an OFF and noble(s), troops must be split:
            #   • Noble row  → escort = noble_escort_min  per noble
            #   • OFF row    → full off minus total escort reserved for all nobles
            total_nobles_from_village = _village_noble_count.get(coord, 0)
            village_also_sends_off    = coord in _village_is_off
            if noble_cnt > 0 and village_also_sends_off:
                # This is a noble attack from a village that also sends an OFF
                displayed_off = noble_escort_min
            elif noble_cnt == 0 and total_nobles_from_village > 0:
                # This is the OFF from a village that also sends noble(s)
                displayed_off = max(0, v["off"] - total_nobles_from_village * noble_escort_min)
            else:
                displayed_off = v["off"]

            attack = {
                "type":         atype,
                "from_coord":   coord,
                "target_coord": _tcoord,
                "off":          displayed_off,
                "nobles":       noble_cnt,
                "burzenie":     "-",
                "send_dt":      send_dt.isoformat(),
                "send_str":     _fmt_window(send_dt, window_min),
                "arrival_str":  _arr_str,
                "distance":     round(d, 2),
                "travel_min":   round(travel_min, 1),
                "attack_link":  link,
                "from_id":      from_id,
                "target_id":    _t_id,
            }
            player_attacks.setdefault(player, []).append(attack)

        for coord in asgn.get("offs", []):
            v_off = village_by_coord.get(coord)
            v_spd = ram_speed if (v_off and v_off.get("rams", 0) > 0) else off_speed
            _add(coord, "OFF", v_spd)
        for coord in asgn.get("nobles", []):
            _add(coord, "SZLACHCIC", noble_speed, noble_cnt=1,
                 _arr_dt=noble_arrival_dt, _arr_str=noble_arrival_str)

    # ── Burzaki ───────────────────────────────────────────────────────────
    CAT_SPEED = 30.0  # catapult travel speed (PL server)
    for asgn in (burst_assignments or []):
        tcoord           = asgn["target"]
        cx, cy           = map(int, tcoord.split('|'))
        t_id             = id_map.get(tcoord)
        building         = asgn.get("building", "") or "dowolny"
        atype            = f"BURZAK ({building})"

        def _add_burst(coord, _cx=cx, _cy=cy, _tcoord=tcoord, _t_id=t_id,
                       _atype=atype, _building=building,
                       _arrival_dt=arrival_dt_default):
            if _arrival_dt is None:
                return
            v = village_by_coord.get(coord)
            if not v:
                return
            player     = player_by_village.get(coord, "Nieprzypisany")
            d          = euclidean(v["x"], v["y"], _cx, _cy)
            travel_min = d * CAT_SPEED
            send_dt    = _arrival_dt - timedelta(minutes=travel_min)
            from_id    = id_map.get(coord)
            link       = _attack_link(server, from_id, _t_id, f"Wyślij {_atype}")
            cats       = v.get('cats', 0)
            burzenie   = f"{cats}×Kata → {_building}"
            player_attacks.setdefault(player, []).append({
                "type":         _atype,
                "from_coord":   coord,
                "target_coord": _tcoord,
                "off":          v["off"],
                "nobles":       0,
                "burzenie":     burzenie,
                "send_dt":      send_dt.isoformat(),
                "send_str":     _fmt_window(send_dt, window_min),
                "arrival_str":  _fmt_window(_arrival_dt, window_min),
                "distance":     round(d, 2),
                "travel_min":   round(travel_min, 1),
                "attack_link":  link,
                "from_id":      from_id,
                "target_id":    _t_id,
            })

        for coord in asgn.get("catapults", []):
            _add_burst(coord)

    # ── Fejki ─────────────────────────────────────────────────────────────
    for asgn in (fake_assignments or []):
        tcoord = asgn["target"]
        cx, cy = map(int, tcoord.split('|'))
        t_id   = id_map.get(tcoord)

        def _add_fake(coord, atype, speed, _cx=cx, _cy=cy, _tcoord=tcoord, _t_id=t_id):
            v = village_by_coord.get(coord)
            if not v:
                return
            player     = player_by_village.get(coord, "Nieprzypisany")
            d          = euclidean(v["x"], v["y"], _cx, _cy)
            travel_min = d * speed
            send_dt    = arrival_dt - timedelta(minutes=travel_min)
            from_id    = id_map.get(coord)
            link       = _attack_link(server, from_id, _t_id, f"Wyślij {atype}")
            player_attacks.setdefault(player, []).append({
                "type":         atype,
                "from_coord":   coord,
                "target_coord": _tcoord,
                "off":          100,
                "nobles":       1 if "SZLACHCIC" in atype else 0,
                "burzenie":     "-",
                "send_dt":      send_dt.isoformat(),
                "send_str":     _fmt_window(send_dt, window_min),
                "arrival_str":  arrival_str,
                "distance":     round(d, 2),
                "travel_min":   round(travel_min, 1),
                "attack_link":  link,
                "from_id":      from_id,
                "target_id":    _t_id,
            })

        for coord in asgn.get("fake_offs", []):
            _add_fake(coord, "FEJK", off_speed)
        for coord in asgn.get("fake_nobles_list", []):
            _add_fake(coord, "FEJK SZLACHCIC", noble_speed)


    messages = []
    subject = f"Cele {action_name} {arrival_dt_fmt}"

    for player, attacks in sorted(player_attacks.items()):
        attacks.sort(key=lambda a: a["send_dt"])

        rows = []
        for i, a in enumerate(attacks, 1):
            rows.append(
                f"[*]{i}"
                f"[|]{a['attack_link']}"
                f"[|]{a['off']}"
                f"[|]{a['nobles']}"
                f"[|]{a['burzenie']}"
                f"[|]{a['send_str']}"
                f"[|]{a['arrival_str']}"
                f"[|][coord]{a['from_coord']}[/coord]"
                f"[|][coord]{a['target_coord']}[/coord]"
            )

        header = (
            "[table][**]"
            "[||]WYŚLIJ[||]OFF[||]SZLACHCICE[||]BURZENIE (tylko burzaki)"
            "[||]WYSYŁKA[||]WEJŚCIE[||]Z WIOSKI[||]CEL"
            "[/**]"
        )
        table = header + "\n" + "\n".join(rows) + "\n[/table]"
        msg = (
            f"[b]{player}[/b]\n\n"
            f"{greeting}\n\n"
            f"Pozdrawiam,\n"
            f"[player]{leader}[/player]\n\n"
            f"{table}"
        )
        mail_url = _mail_link(server, player, subject, msg)

        messages.append({
            "player":    player,
            "message":   msg,
            "mail_link": mail_url,
            "attacks":   attacks,
        })

    return messages
