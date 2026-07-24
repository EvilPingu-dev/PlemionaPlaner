"""Routes: Discord bot control."""
from flask import Blueprint, jsonify, request

from ..discord_bot import (
    bot_running,
    load_discord_config,
    save_discord_config,
    start_bot,
    stop_bot,
)

bp = Blueprint("discord", __name__)


@bp.get("/api/discord/config")
def get_discord_config():
    cfg = load_discord_config()
    # Never send the token back to the frontend
    safe = {k: v for k, v in cfg.items() if k != "token"}
    safe["has_token"] = bool(cfg.get("token"))
    safe["running"]   = bot_running()
    return jsonify(safe)


@bp.post("/api/discord/config")
def set_discord_config():
    body = request.get_json(silent=True) or {}
    cfg  = load_discord_config()

    if "token" in body and body["token"].strip():
        cfg["token"] = body["token"].strip()
    if "channel_id" in body:
        cfg["channel_id"] = int(body["channel_id"])
    if "reminder_mins" in body:
        cfg["reminder_mins"] = int(body["reminder_mins"])

    save_discord_config(cfg)
    return jsonify({"ok": True})


@bp.post("/api/discord/start")
def discord_start():
    cfg = load_discord_config()
    token      = cfg.get("token", "")
    channel_id = cfg.get("channel_id", 0)
    reminder   = cfg.get("reminder_mins", 15)

    if not token:
        return jsonify({"error": "Brak tokena bota."}), 400
    if not channel_id:
        return jsonify({"error": "Brak ID kanału."}), 400

    start_bot(token, channel_id, reminder)
    return jsonify({"ok": True, "running": True})


@bp.post("/api/discord/stop")
def discord_stop():
    stop_bot()
    return jsonify({"ok": True, "running": False})


@bp.post("/api/discord/test")
def discord_test():
    from ..discord_bot import _bot_client
    if not bot_running() or not _bot_client:
        return jsonify({"error": "Bot nie jest uruchomiony. Najpierw go uruchom."}), 400

    import asyncio
    from ..discord_bot import _bot_loop

    async def _send():
        channel = _bot_client.get_channel(_bot_client.channel_id)
        if not channel:
            return False
        await channel.send("🧪 **Test Planera Akcji** – bot działa poprawnie! Przypomnienia będą wysyłane na ten kanał.")
        return True

    future = asyncio.run_coroutine_threadsafe(_send(), _bot_loop)
    try:
        ok = future.result(timeout=10)
        if ok:
            return jsonify({"ok": True})
        return jsonify({"error": "Nie znaleziono kanału. Sprawdź ID kanału."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.get("/api/discord/status")
def discord_status():
    return jsonify({"running": bot_running()})
