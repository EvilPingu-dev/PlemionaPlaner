import math
from datetime import datetime, timedelta

# Night window: no sends between 23:30 and 07:30
_NIGHT_START_MIN = 23 * 60 + 30   # 1410
_NIGHT_END_MIN   =  7 * 60 + 30   # 450


def _dist(x1: int, y1: int, x2: int, y2: int) -> float:
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)


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
        [v for v in villages if v["off"] > 0 and v["coord"] not in skip],
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
                          if not is_night_send(_dist(v["x"], v["y"], tx, ty), off_speed, t_arrival)]

        if off_sort == "farthest":
            candidates.sort(key=lambda v: -_dist(v["x"], v["y"], tx, ty))
        elif off_sort == "strongest":
            candidates.sort(key=lambda v: -v["off"])
        else:  # "closest" — prefer non-night first, then distance
            candidates.sort(key=lambda v: (
                int(is_night_send(_dist(v["x"], v["y"], tx, ty), off_speed, t_arrival)),
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
                "is_night": is_night_send(_dist(v["x"], v["y"], tx, ty), off_speed, t_arrival),
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
                if block_night_sends and is_night_send(_dist(v["x"], v["y"], tx, ty), off_speed, arrival_datetime):
                    continue
                d = round(_dist(v["x"], v["y"], tx, ty), 1)
                a["offs"].append(v["coord"])
                a["offs_detail"].append({"coord": v["coord"], "dist": d,
                                          "is_night": is_night_send(d, off_speed, arrival_datetime)})
                a["offs_missing"] -= 1
                used_off_coords.add(v["coord"])

    # Summary counts available villages (excluding disabled)
    available_villages = [v for v in villages if v["coord"] not in skip]
    summary = {
        "offs_available":   len([v for v in available_villages if v["off"] > 0]),
        "offs_total":       sum(v["off"]    for v in available_villages),
        "nobles_available": sum(v["nobles"] for v in available_villages),
        "cats_available":   sum(v["cats"]   for v in available_villages),
        "offs_assigned":    len(used_off_coords),
        "nobles_assigned":  noble_assigned_count,
    }

    # ── Burzaki (catapult attacks, after noble plan) ───────────────────────
    burst_assignments: list[dict] = []
    used_burst_coords: set[str] = set()
    for bt in (burst_targets or []):
        cx, cy   = map(int, bt["coord"].split('|'))
        needed   = bt.get("attacks", 0)
        building = bt.get("building", "")
        btype    = bt.get("building_type", "")
        cat_cands = sorted(
            [v for v in villages
             if v.get("cats", 0) > 0
             and v["coord"] not in skip
             and v["coord"] not in used_off_coords
             and v["coord"] not in used_burst_coords],
            key=lambda v: _dist(v["x"], v["y"], cx, cy),
        )
        chosen = cat_cands[:needed]
        used_burst_coords.update(v["coord"] for v in chosen)
        detail = [
            {"coord": v["coord"],
             "dist": round(_dist(v["x"], v["y"], cx, cy), 1),
             "is_night": is_night_send(_dist(v["x"], v["y"], cx, cy), off_speed, arrival_datetime)}
            for v in chosen
        ]
        burst_assignments.append({
            "target":            bt["coord"],
            "attacks":           needed,
            "building":          building,
            "building_type":     btype,
            "catapults":         [d["coord"] for d in detail],
            "catapults_detail":  detail,
            "catapults_missing": needed - len(chosen),
        })

    # ── Fejki (fake attacks, after burzaki) ───────────────────────────────
    fake_assignments: list[dict] = []
    used_fake_coords: set[str] = set()
    remaining_nobles = [nv for i, nv in enumerate(noble_pool) if i not in used_noble_indices]

    for ft in (fake_targets or []):
        cx, cy        = map(int, ft["coord"].split('|'))
        fakes_needed  = ft.get("fakes", 0)
        fn_needed     = ft.get("fake_nobles", 0)

        # Fake offs: unused villages (not real offs / burzaks / already used as fakes)
        fake_pool = sorted(
            [v for v in villages
             if v["coord"] not in skip
             and v["coord"] not in used_off_coords
             and v["coord"] not in used_burst_coords
             and v["coord"] not in used_fake_coords],
            key=lambda v: _dist(v["x"], v["y"], cx, cy),
        )
        chosen_fo = fake_pool[:fakes_needed]
        used_fake_coords.update(v["coord"] for v in chosen_fo)

        # Fake nobles: remaining noble pool not consumed by real targets
        fn_sorted = sorted(
            [nv for nv in remaining_nobles if nv["coord"] not in skip],
            key=lambda nv: _dist(nv["x"], nv["y"], cx, cy),
        )
        chosen_fn = fn_sorted[:fn_needed]
        for nv in chosen_fn:
            if nv in remaining_nobles:
                remaining_nobles.remove(nv)

        fo_detail = [
            {"coord": v["coord"],
             "dist": round(_dist(v["x"], v["y"], cx, cy), 1),
             "is_night": is_night_send(_dist(v["x"], v["y"], cx, cy), off_speed, arrival_datetime)}
            for v in chosen_fo
        ]
        fn_detail = [
            {"coord": nv["coord"],
             "dist": round(_dist(nv["x"], nv["y"], cx, cy), 1),
             "is_night": is_night_send(_dist(nv["x"], nv["y"], cx, cy), noble_speed, arrival_datetime)}
            for nv in chosen_fn
        ]
        fake_assignments.append({
            "target":               ft["coord"],
            "fakes":                fakes_needed,
            "fake_nobles":          fn_needed,
            "fake_offs":            [d["coord"] for d in fo_detail],
            "fake_offs_detail":     fo_detail,
            "fake_nobles_list":     [d["coord"] for d in fn_detail],
            "fake_nobles_detail":   fn_detail,
            "fake_offs_missing":    fakes_needed - len(chosen_fo),
            "fake_nobles_missing":  fn_needed - len(chosen_fn),
        })

    return assignments, burst_assignments, fake_assignments, summary
