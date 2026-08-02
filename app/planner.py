import math
import random
from datetime import datetime, timedelta

# Night window: no sends between 23:30 and 07:30
_NIGHT_START_MIN = 23 * 60 + 30   # 1410
_NIGHT_END_MIN   =  7 * 60 + 30   # 450


def _dist(x1: int, y1: int, x2: int, y2: int) -> float:
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)


def _eff_off_speed(v: dict, off_speed: float, ram_speed: float) -> float:
    """Return effective travel speed for an OFF village: ram_speed when it has rams."""
    return ram_speed if v.get("rams", 0) > 0 else off_speed


def is_night_send(dist: float, speed: float, arrival_dt: datetime | None) -> bool:
    """Return True if the send time for this village falls in the 23:30–07:30 window."""
    if arrival_dt is None or speed <= 0:
        return False
    send_dt = arrival_dt - timedelta(minutes=dist * speed)
    t = send_dt.hour * 60 + send_dt.minute
    return t >= _NIGHT_START_MIN or t <= _NIGHT_END_MIN


def plan_action(
    villages: list,
    targets: list,
    disabled_coords: set | None = None,
    arrival_datetime: datetime | None = None,
    arrival_slots: dict | None = None,   # {slot_index: datetime}  1-based
    off_speed: float = 18.0,
    ram_speed: float = 30.0,
    noble_speed: float = 35.0,
    conflicts: list | None = None,
    coord_to_player: dict | None = None,
    separations: list | None = None,
    target_owner_map: dict | None = None,
    block_night_sends: bool = False,
    off_sort: str = "closest",
    off_sort_invert: bool = False,
    noble_sort: str = "closest",
    noble_sort_invert: bool = False,
    noble_max_dist: float = 60.0,
    noble_min_dist: float = 0.0,
    max_off_dist: float = 0.0,
    min_off_dist: float = 0.0,
    min_off: int = 0,
    fill_free_villages: bool = False,
    fake_targets: list | None = None,
    burst_targets: list | None = None,
    off_noble_gap_minutes: float = 0.0,
) -> tuple[list, list, list, dict]:
    """
    Assign offensive villages and nobles to targets.
    Then plan burzaki (catapult attacks) and fejki (fake attacks) from remaining villages.

    Returns (assignments, burst_assignments, fake_assignments, summary).
    """
    skip = disabled_coords or set()
    c2p  = coord_to_player or {}
    tom  = target_owner_map or {}

    # Deduplicate targets: merge same-coord entries (sum offs/nobles, keep earliest slot).
    # Duplicate coords cause two separate assignments with potentially inverted arrival times
    # (e.g. nobles at slot-1 and offs at slot-2), making offs arrive *after* nobles.
    _seen_target: dict[str, int] = {}
    _deduped: list = []
    for _t in targets:
        _coord = _t["coord"]
        if _coord in _seen_target:
            _existing = _deduped[_seen_target[_coord]]
            _existing["offs_needed"]   += _t.get("offs_needed",   0)
            _existing["nobles_needed"] += _t.get("nobles_needed", 0)
            if _t.get("arrival_slot", 1) < _existing.get("arrival_slot", 1):
                _existing["arrival_slot"] = _t["arrival_slot"]
        else:
            _seen_target[_coord] = len(_deduped)
            _deduped.append(dict(_t))
    targets = _deduped

    conflict_map: dict[str, set[str]] = {}
    for pair in (conflicts or []):
        if len(pair) == 2:
            a, b = pair
            conflict_map.setdefault(a, set()).add(b)
            conflict_map.setdefault(b, set()).add(a)

    sep_map: dict[str, set[str]] = {}
    for pair in (separations or []):
        if len(pair) == 2:
            a, b = pair
            sep_map.setdefault(a, set()).add(b)
            sep_map.setdefault(b, set()).add(a)

    enemy_player_friendly: dict[str, set[str]] = {}

    off_pool = sorted(
        [v for v in villages if v["off"] > 0 and v["coord"] not in skip
         and (min_off <= 0 or v["off"] >= min_off)],
        key=lambda v: -v["off"],
    )

    noble_pool: list[dict] = []
    for v in villages:
        if v["coord"] in skip:
            continue
        for _ in range(v["nobles"]):
            noble_pool.append({"coord": v["coord"], "x": v["x"], "y": v["y"]})

    used_off_coords: set[str] = set()
    used_noble_indices: set[int] = set()
    noble_assigned_count: int = 0
    assignments: list[dict] = []

    for t in targets:
        tx, ty      = t["x"], t["y"]
        tcoord      = t["coord"]
        # Per-target arrival time: use slot if defined, else fall back to arrival_datetime
        slot_idx    = t.get("arrival_slot", 1)
        t_arrival   = (arrival_slots or {}).get(slot_idx, arrival_datetime) if arrival_slots else arrival_datetime
        t_noble_arrival = (
            t_arrival + timedelta(minutes=off_noble_gap_minutes)
            if t_arrival and off_noble_gap_minutes
            else t_arrival
        )
        enemy_owner = tom.get(tcoord)
        already_on_enemy: set[str] = enemy_player_friendly.get(enemy_owner, set()) if enemy_owner else set()
        picked_for_target: set[str] = set()

        def _blocked(v_coord: str) -> bool:
            fp = c2p.get(v_coord)
            if not fp:
                return False
            if conflict_map:
                for pp in picked_for_target:
                    if pp in conflict_map.get(fp, set()):
                        return True
            if sep_map and enemy_owner:
                for pp in already_on_enemy:
                    if pp in sep_map.get(fp, set()):
                        return True
            return False

        # Candidate offs: apply distance + night filters
        candidates = [v for v in off_pool if v["coord"] not in used_off_coords]
        if max_off_dist > 0:
            candidates = [v for v in candidates
                          if _dist(v["x"], v["y"], tx, ty) <= max_off_dist]
        if min_off_dist > 0:
            candidates = [v for v in candidates
                          if _dist(v["x"], v["y"], tx, ty) >= min_off_dist]
        if block_night_sends:
            candidates = [v for v in candidates
                          if not is_night_send(_dist(v["x"], v["y"], tx, ty),
                                               _eff_off_speed(v, off_speed, ram_speed), t_arrival)]

        if off_sort == "farthest":
            candidates.sort(key=lambda v: -_dist(v["x"], v["y"], tx, ty))
        elif off_sort == "strongest":
            candidates.sort(key=lambda v: -v["off"])
        else:  # "closest" — prefer non-night first, then distance
            candidates.sort(key=lambda v: (
                int(is_night_send(_dist(v["x"], v["y"], tx, ty),
                                  _eff_off_speed(v, off_speed, ram_speed), t_arrival)),
                _dist(v["x"], v["y"], tx, ty),
            ))
        if off_sort_invert:
            candidates.reverse()

        chosen_offs: list[dict] = []
        for v in candidates:
            if len(chosen_offs) >= t["offs_needed"]:
                break
            if _blocked(v["coord"]):
                continue
            chosen_offs.append(v)
            used_off_coords.add(v["coord"])
            fp = c2p.get(v["coord"])
            if fp:
                picked_for_target.add(fp)
                if enemy_owner:
                    enemy_player_friendly.setdefault(enemy_owner, set()).add(fp)
                    already_on_enemy.add(fp)

        # Nobles: filter by distance bounds + night, then pick from unused pool entries
        chosen_nobles: list[dict] = []

        # Build indexed candidate list from unconsumed pool entries
        noble_candidates = [
            (i, nv) for i, nv in enumerate(noble_pool)
            if i not in used_noble_indices
            and nv["coord"] not in skip
            and (noble_max_dist <= 0 or _dist(nv["x"], nv["y"], tx, ty) <= noble_max_dist)
            and (noble_min_dist <= 0 or _dist(nv["x"], nv["y"], tx, ty) >= noble_min_dist)
            and not (block_night_sends and is_night_send(_dist(nv["x"], nv["y"], tx, ty), noble_speed, t_arrival))
        ]
        if noble_sort == "farthest":
            noble_candidates.sort(key=lambda x: -_dist(x[1]["x"], x[1]["y"], tx, ty))
        elif noble_sort == "strongest":
            noble_candidates.sort(key=lambda x: -next((vv["off"] for vv in villages if vv["coord"] == x[1]["coord"]), 0))
        else:  # closest
            noble_candidates.sort(key=lambda x: (
                int(is_night_send(_dist(x[1]["x"], x[1]["y"], tx, ty), noble_speed, t_arrival)),
                _dist(x[1]["x"], x[1]["y"], tx, ty),
            ))
        if noble_sort_invert:
            noble_candidates.reverse()

        # ── Prefer a single player who can cover the entire noble requirement ──
        # Group candidates by player; if any player has enough nobles and none
        # are blocked, use that group exclusively (keeps train in one player's hands).
        if c2p and t["nobles_needed"] > 1:
            from collections import defaultdict
            by_player: dict = defaultdict(list)
            for i, nv in noble_candidates:
                fp = c2p.get(nv["coord"])
                if fp:
                    by_player[fp].append((i, nv))
            # Pick the best player: enough nobles, no blocked, sorted by our key
            for fp, group in by_player.items():
                if len(group) >= t["nobles_needed"] and not any(_blocked(nv["coord"]) for _, nv in group):
                    chosen_nobles = [nv for _, nv in group[:t["nobles_needed"]]]
                    for idx, _ in group[:t["nobles_needed"]]:
                        used_noble_indices.add(idx)
                        noble_assigned_count += 1
                    picked_for_target.add(fp)
                    if enemy_owner:
                        enemy_player_friendly.setdefault(enemy_owner, set()).add(fp)
                        already_on_enemy.add(fp)
                    break

        if not chosen_nobles:
            for i, nv in noble_candidates:
                if len(chosen_nobles) >= t["nobles_needed"]:
                    break
                if _blocked(nv["coord"]):
                    continue
                chosen_nobles.append(nv)
                used_noble_indices.add(i)
                noble_assigned_count += 1
                fp = c2p.get(nv["coord"])
                if fp:
                    picked_for_target.add(fp)
                    if enemy_owner:
                        enemy_player_friendly.setdefault(enemy_owner, set()).add(fp)
                        already_on_enemy.add(fp)
        offs_detail = [
            {
                "coord":    v["coord"],
                "dist":     round(_dist(v["x"], v["y"], tx, ty), 1),
                "speed":    _eff_off_speed(v, off_speed, ram_speed),
                "off":      v["off"],
                "is_night": is_night_send(_dist(v["x"], v["y"], tx, ty),
                                          _eff_off_speed(v, off_speed, ram_speed), t_arrival),
            }
            for v in chosen_offs
        ]
        nobles_detail = [
            {
                "coord":    v["coord"],
                "dist":     round(_dist(v["x"], v["y"], tx, ty), 1),
                "is_night": is_night_send(_dist(v["x"], v["y"], tx, ty), noble_speed, t_arrival),
            }
            for v in chosen_nobles
        ]

        assignments.append(
            {
                "target":           tcoord,
                "arrival_slot":     slot_idx,
                "arrival_dt":       t_arrival.isoformat()       if t_arrival       else None,
                "noble_arrival_dt": t_noble_arrival.isoformat() if t_noble_arrival else None,
                "offs_needed":    t["offs_needed"],
                "nobles_needed":  t["nobles_needed"],
                "offs":           [d["coord"] for d in offs_detail],
                "offs_detail":    offs_detail,
                "nobles":         [d["coord"] for d in nobles_detail],
                "nobles_detail":  nobles_detail,
                "offs_missing":   t["offs_needed"]   - len(chosen_offs),
                "nobles_missing": t["nobles_needed"] - len(chosen_nobles),
            }
        )

    # ── Fill free villages (second pass) ─────────────────────────────────────
    if fill_free_villages:
        for a in assignments:
            if a["offs_missing"] <= 0:
                continue
            tx = next((t["x"] for t in targets if t["coord"] == a["target"]), None)
            ty = next((t["y"] for t in targets if t["coord"] == a["target"]), None)
            if tx is None:
                continue
            free = sorted(
                [v for v in off_pool if v["coord"] not in used_off_coords],
                key=lambda v: _dist(v["x"], v["y"], tx, ty),
            )
            for v in free:
                if a["offs_missing"] <= 0:
                    break
                eff_spd = _eff_off_speed(v, off_speed, ram_speed)
                if block_night_sends and is_night_send(_dist(v["x"], v["y"], tx, ty), eff_spd, arrival_datetime):
                    continue
                d = round(_dist(v["x"], v["y"], tx, ty), 1)
                a["offs"].append(v["coord"])
                a["offs_detail"].append({"coord": v["coord"], "dist": d,
                                          "speed": eff_spd,
                                          "is_night": is_night_send(d, eff_spd, arrival_datetime)})
                a["offs_missing"] -= 1
                used_off_coords.add(v["coord"])

    # Summary counts available villages (excluding disabled)
    available_villages = [v for v in villages if v["coord"] not in skip]
    _offs_avail = len([v for v in available_villages if v["off"] > 0])
    summary = {
        "offs_available":   _offs_avail,
        "offs_total":       sum(v["off"]    for v in available_villages),
        "nobles_available": sum(v["nobles"] for v in available_villages),
        "cats_available":   sum(v["cats"]   for v in available_villages),
        "offs_assigned":    len(used_off_coords),
        "nobles_assigned":  noble_assigned_count,
        "offs_free":        _offs_avail - len(used_off_coords),
    }

    # ── Burzaki (catapult attacks, after noble plan) ───────────────────────
    _slot_dts = list((arrival_slots or {}).values()) if arrival_slots else []
    if not _slot_dts and arrival_datetime:
        _slot_dts = [arrival_datetime]

    burst_assignments: list[dict] = []
    used_burst_coords: set[str] = set()
    for bt in (burst_targets or []):
        cx, cy   = map(int, bt["coord"].split('|'))
        needed   = bt.get("attacks", 0)
        building = bt.get("building", "")
        btype    = bt.get("building_type", "")
        bt_arrival = random.choice(_slot_dts) if _slot_dts else arrival_datetime
        cat_cands = sorted(
            [v for v in villages
             if v.get("cats", 0) > 0
             and v["coord"] not in skip
             and v["coord"] not in used_off_coords
             and v["coord"] not in used_burst_coords
             and not (block_night_sends and is_night_send(_dist(v["x"], v["y"], cx, cy), ram_speed, bt_arrival))],
            key=lambda v: _dist(v["x"], v["y"], cx, cy),
        )
        chosen = cat_cands[:needed]
        used_burst_coords.update(v["coord"] for v in chosen)
        detail = [
            {"coord": v["coord"],
             "dist": round(_dist(v["x"], v["y"], cx, cy), 1),
             "is_night": is_night_send(_dist(v["x"], v["y"], cx, cy), ram_speed, bt_arrival)}
            for v in chosen
        ]
        burst_assignments.append({
            "target":            bt["coord"],
            "attacks":           needed,
            "building":          building,
            "building_type":     btype,
            "arrival_dt":        bt_arrival.isoformat() if bt_arrival else None,
            "catapults":         [d["coord"] for d in detail],
            "catapults_detail":  detail,
            "catapults_missing": needed - len(chosen),
        })

    # ── Fejki (fake attacks, after burzaki) ───────────────────────────────

    # Collect all existing send times per player to avoid send-time conflicts in fejki
    _player_send_times: dict[str, list[datetime]] = {}
    for _a in assignments:
        _raw = _a.get("arrival_dt")
        if not _raw:
            continue
        _arr = datetime.fromisoformat(_raw)
        for _od in _a.get("offs_detail", []):
            _pl = c2p.get(_od["coord"])
            if _pl:
                _player_send_times.setdefault(_pl, []).append(
                    _arr - timedelta(minutes=_od["dist"] * _od.get("speed", off_speed)))
        _raw_n = _a.get("noble_arrival_dt") or _raw
        _narr  = datetime.fromisoformat(_raw_n)
        for _nd in _a.get("nobles_detail", []):
            _pl = c2p.get(_nd["coord"])
            if _pl:
                _player_send_times.setdefault(_pl, []).append(
                    _narr - timedelta(minutes=_nd["dist"] * noble_speed))
    for _ba in burst_assignments:
        _raw = _ba.get("arrival_dt")
        if not _raw:
            continue
        _arr = datetime.fromisoformat(_raw)
        for _cd in _ba.get("catapults_detail", []):
            _pl = c2p.get(_cd["coord"])
            if _pl:
                _player_send_times.setdefault(_pl, []).append(
                    _arr - timedelta(minutes=_cd["dist"] * ram_speed))

    def _no_send_conflict(coord: str, send_dt: datetime) -> bool:
        pl = c2p.get(coord)
        if not pl:
            return True
        return all(abs((send_dt - e).total_seconds()) >= 30
                   for e in _player_send_times.get(pl, []))

    fake_assignments: list[dict] = []
    used_fake_coords: set[str] = set()
    remaining_nobles = [nv for i, nv in enumerate(noble_pool) if i not in used_noble_indices]

    for ft in (fake_targets or []):
        cx, cy        = map(int, ft["coord"].split('|'))
        fakes_needed  = ft.get("fakes", 0)
        fn_needed     = ft.get("fake_nobles", 0)
        ft_arrival    = random.choice(_slot_dts) if _slot_dts else arrival_datetime

        # Fake offs: unused villages with rams or cats, no night send, no send-time conflict
        fake_pool = sorted(
            [v for v in villages
             if v["coord"] not in skip
             and v["coord"] not in used_off_coords
             and v["coord"] not in used_burst_coords
             and v["coord"] not in used_fake_coords
             and (v.get("rams", 0) > 0 or v.get("cats", 0) > 0)
             and not (block_night_sends and is_night_send(_dist(v["x"], v["y"], cx, cy), off_speed, ft_arrival))
             and (ft_arrival is None or _no_send_conflict(
                 v["coord"],
                 ft_arrival - timedelta(minutes=_dist(v["x"], v["y"], cx, cy) * off_speed)))],
            key=lambda v: _dist(v["x"], v["y"], cx, cy),
        )
        chosen_fo = fake_pool[:fakes_needed]
        used_fake_coords.update(v["coord"] for v in chosen_fo)
        # Register their send times
        for v in chosen_fo:
            pl = c2p.get(v["coord"])
            if pl and ft_arrival:
                sd = ft_arrival - timedelta(minutes=_dist(v["x"], v["y"], cx, cy) * off_speed)
                _player_send_times.setdefault(pl, []).append(sd)

        # Fake nobles: remaining noble pool, no night send, no send-time conflict
        fn_sorted = sorted(
            [nv for nv in remaining_nobles
             if nv["coord"] not in skip
             and not (block_night_sends and is_night_send(_dist(nv["x"], nv["y"], cx, cy), noble_speed, ft_arrival))
             and (ft_arrival is None or _no_send_conflict(
                 nv["coord"],
                 ft_arrival - timedelta(minutes=_dist(nv["x"], nv["y"], cx, cy) * noble_speed)))],
            key=lambda nv: _dist(nv["x"], nv["y"], cx, cy),
        )
        chosen_fn = fn_sorted[:fn_needed]
        for nv in chosen_fn:
            if nv in remaining_nobles:
                remaining_nobles.remove(nv)
            pl = c2p.get(nv["coord"])
            if pl and ft_arrival:
                sd = ft_arrival - timedelta(minutes=_dist(nv["x"], nv["y"], cx, cy) * noble_speed)
                _player_send_times.setdefault(pl, []).append(sd)

        fo_detail = [
            {"coord": v["coord"],
             "dist": round(_dist(v["x"], v["y"], cx, cy), 1),
             "is_night": is_night_send(_dist(v["x"], v["y"], cx, cy), off_speed, ft_arrival)}
            for v in chosen_fo
        ]
        fn_detail = [
            {"coord": nv["coord"],
             "dist": round(_dist(nv["x"], nv["y"], cx, cy), 1),
             "is_night": is_night_send(_dist(nv["x"], nv["y"], cx, cy), noble_speed, ft_arrival)}
            for nv in chosen_fn
        ]
        fake_assignments.append({
            "target":               ft["coord"],
            "fakes":                fakes_needed,
            "fake_nobles":          fn_needed,
            "arrival_dt":           ft_arrival.isoformat() if ft_arrival else None,
            "fake_offs":            [d["coord"] for d in fo_detail],
            "fake_offs_detail":     fo_detail,
            "fake_nobles_list":     [d["coord"] for d in fn_detail],
            "fake_nobles_detail":   fn_detail,
            "fake_offs_missing":    fakes_needed - len(chosen_fo),
            "fake_nobles_missing":  fn_needed - len(chosen_fn),
        })

    return assignments, burst_assignments, fake_assignments, summary

