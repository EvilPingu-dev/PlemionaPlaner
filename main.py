import os
import socket
import sys
import threading
import webbrowser

# Force UTF-8 on Windows — prevents charmap codec errors with Polish characters
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from app import create_app


def _find_free_port(start: int = 5000) -> int:
    """Find the first available TCP port starting from `start`."""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def _resource_path(relative: str) -> str:
    """Return absolute path — works both in dev and when frozen by PyInstaller."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)


# Point Flask at the correct template / static directories when frozen
app = create_app(
    template_folder=_resource_path("app/templates"),
    static_folder=_resource_path("app/static"),
)

if __name__ == "__main__":
    frozen = getattr(sys, "frozen", False)          # True when built with PyInstaller
    dev    = not frozen and os.environ.get("PLANER_DEV") == "1"
    port   = _find_free_port(5000)
    url    = f"http://127.0.0.1:{port}"

    if dev:
        # Explicit dev mode (PLANER_DEV=1) — hot reload, no auto-browser
        app.run(host="127.0.0.1", port=port, debug=True)
    else:
        # Normal launch (start.bat or frozen) — no debug noise, auto-browser
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
        print(f"Planer Akcji uruchomiony → {url}")
        print("Zamknij to okno aby zatrzymać aplikację.")
        app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
