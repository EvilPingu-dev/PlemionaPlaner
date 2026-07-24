from flask import Blueprint, render_template

bp_pages = Blueprint("pages", __name__)


@bp_pages.get("/")
def index():
    return render_template("index.html")


# Import sub-modules so their blueprints are available
from .data     import bp as bp_data      # noqa: E402, F401
from .plan     import bp as bp_plan      # noqa: E402, F401
from .players  import bp as bp_players   # noqa: E402, F401
from .messages import bp as bp_messages  # noqa: E402, F401
from .tools    import bp as bp_tools     # noqa: E402, F401
from .export   import bp as bp_export    # noqa: E402, F401
from .status   import bp as bp_status    # noqa: E402, F401
from .discord  import bp as bp_discord   # noqa: E402, F401

blueprints = [bp_pages, bp_data, bp_plan, bp_players, bp_messages, bp_tools, bp_export, bp_status, bp_discord]
