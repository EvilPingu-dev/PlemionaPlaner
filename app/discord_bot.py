"""Discord reminder bot — posts send reminders to a channel before each attack."""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timedelta, timezone

import discord

from .storage import DATA_DIR, PLAN_FILE, TROOPS_FILE, PLAYER_MAP_FILE, load_json, load_settings, load_troops

log = logging.getLogger(__name__)

DISCORD_CONFIG_FILE = DATA_DIR / "discord_config.json"

# ── Config helpers ────────────────────────────────────────────────────────────

def load_discord_config() -> dict:
    from .storage import load_json
    return load_json(DISCORD_CONFIG_FILE) or {}


def save_discord_config(cfg: dict) -> None:
    from .storage import save_json
    save_json(DISCORD_CONFIG_FILE, cfg)


# ── Send-schedule builder ─────────────────────────────────────────────────────

def _build_send_schedule() -> list[dict]:
    """Return list of {player, send_dt(datetime), coord, target, type} sorted by send_dt."""
    plan     = load_json(PLAN_FILE)
    settings = load_settings()
    villages = load_troops() or []
    pm_list  = load_json(PLAYER_MAP_FILE) or []

    if not isinstance(plan, dict) or not plan.get("assignments"):
        return []

    from .planner import _dist
    import math

    off_speed   = float(settings.get("off_speed",   18))
    noble_speed = float(settings.get("noble_speed", 35))

    village_by_coord = {v["coord"]: v for v in villages}
    player_by_coord: dict[str, str] = {}
    for pm in pm_list:
        for coord in pm.get("villages", []):
            player_by_coord[coord.strip()] = pm["player"]

    schedule: list[dict] = []

    for asgn in plan.get("assignments", []):
        tcoord  = asgn["target"]
        raw_adt = asgn.get("arrival_dt")
        raw_ndt = asgn.get("noble_arrival_dt") or raw_adt
        if not raw_adt:
            continue
        arr_dt   = datetime.fromisoformat(raw_adt)
        noble_dt = datetime.fromisoformat(raw_ndt)

        for coord in asgn.get("offs", []):
            v = village_by_coord.get(coord)
            if not v:
                continue
            tx, ty = map(int, tcoord.split("|"))
            d = math.sqrt((v["x"] - tx) ** 2 + (v["y"] - ty) ** 2)
            send_dt = arr_dt - timedelta(minutes=d * off_speed)
            schedule.append({
                "player": player_by_coord.get(coord, coord),
                "coord":  coord,
                "target": tcoord,
                "type":   "OFF",
                "send_dt": send_dt,
            })

        for coord in asgn.get("nobles", []):
            v = village_by_coord.get(coord)
            if not v:
                continue
            tx, ty = map(int, tcoord.split("|"))
            d = math.sqrt((v["x"] - tx) ** 2 + (v["y"] - ty) ** 2)
            send_dt = noble_dt - timedelta(minutes=d * noble_speed)
            schedule.append({
                "player": player_by_coord.get(coord, coord),
                "coord":  coord,
                "target": tcoord,
                "type":   "SZLACHCIC",
                "send_dt": send_dt,
            })

    schedule.sort(key=lambda s: s["send_dt"])
    return schedule


def _group_by_player_window(schedule: list[dict], window_sec: int = 60) -> list[dict]:
    """
    Group sends that belong to the same player within `window_sec` seconds of each other
    into one reminder message.
    """
    if not schedule:
        return []

    groups: list[dict] = []
    current_player = schedule[0]["player"]
    current_time   = schedule[0]["send_dt"]
    current_sends  = [schedule[0]]

    for s in schedule[1:]:
        if (s["player"] == current_player and
                abs((s["send_dt"] - current_time).total_seconds()) <= window_sec):
            current_sends.append(s)
        else:
            groups.append({"player": current_player, "send_dt": current_time, "sends": current_sends})
            current_player = s["player"]
            current_time   = s["send_dt"]
            current_sends  = [s]

    groups.append({"player": current_player, "send_dt": current_time, "sends": current_sends})
    return groups


# ── Discord client ────────────────────────────────────────────────────────────

class ReminderBot(discord.Client):
    def __init__(self, channel_id: int, reminder_mins: int):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.channel_id    = channel_id
        self.reminder_mins = reminder_mins
        self._scheduled_ids: set[str] = set()   # track already-scheduled groups

    async def on_ready(self):
        log.info("Discord bot zalogowany jako %s", self.user)
        settings = load_settings()
        action   = settings.get("action_name", "Akcja")
        channel  = self.get_channel(self.channel_id)
        if channel:
            await channel.send(
                f"🟢 **Planer Akcji – {action}** online. "
                f"Przypomnienia {self.reminder_mins} min przed wysyłką."
            )
        self.loop.create_task(self._schedule_loop())

    async def _schedule_loop(self):
        """Re-check the plan every 60 s and schedule any new reminders."""
        while not self.is_closed():
            await self._refresh_reminders()
            await asyncio.sleep(60)

    async def _refresh_reminders(self):
        now     = datetime.now()
        sched   = _build_send_schedule()
        groups  = _group_by_player_window(sched)
        channel = self.get_channel(self.channel_id)
        if not channel:
            return

        for g in groups:
            group_id = f"{g['player']}@{g['send_dt'].isoformat()}"
            if group_id in self._scheduled_ids:
                continue

            remind_at = g["send_dt"] - timedelta(minutes=self.reminder_mins)
            delay_sec = (remind_at - datetime.now()).total_seconds()

            if delay_sec < 0:
                # Already past — mark as done so we don't keep trying
                self._scheduled_ids.add(group_id)
                continue

            self._scheduled_ids.add(group_id)
            self.loop.create_task(self._fire_reminder(delay_sec, g, channel))

    async def _fire_reminder(self, delay_sec: float, group: dict, channel):
        await asyncio.sleep(delay_sec)
        sends    = group["sends"]
        player   = group["player"]
        send_dt  = group["send_dt"]
        time_str = send_dt.strftime("%H:%M:%S")

        lines = [f"⏰ **{player}** — wysyłka o **{time_str}**"]
        for s in sends:
            label = "🗡 OFF" if s["type"] == "OFF" else "👑 SZLACHCIC"
            lines.append(f"  {label}: `{s['coord']}` → `{s['target']}`")

        await channel.send("\n".join(lines))


# ── Thread management (called from Flask app) ─────────────────────────────────

_bot_thread: threading.Thread | None = None
_bot_client: ReminderBot | None      = None
_bot_loop:   asyncio.AbstractEventLoop | None = None


def start_bot(token: str, channel_id: int, reminder_mins: int) -> None:
    global _bot_thread, _bot_client, _bot_loop

    stop_bot()  # stop previous instance if running

    def _run():
        global _bot_client, _bot_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _bot_loop   = loop
        _bot_client = ReminderBot(channel_id=channel_id, reminder_mins=reminder_mins)
        try:
            loop.run_until_complete(_bot_client.start(token))
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.error("Discord bot error: %s", exc)
        finally:
            loop.close()

    _bot_thread = threading.Thread(target=_run, daemon=True, name="discord-bot")
    _bot_thread.start()


def stop_bot() -> None:
    global _bot_client, _bot_loop, _bot_thread
    if _bot_client and _bot_loop and not _bot_loop.is_closed():
        asyncio.run_coroutine_threadsafe(_bot_client.close(), _bot_loop)
    _bot_client = None
    _bot_loop   = None
    _bot_thread = None


def bot_running() -> bool:
    return _bot_thread is not None and _bot_thread.is_alive()
