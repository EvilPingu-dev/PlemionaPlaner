from flask import Flask, send_from_directory
import os


def create_app(template_folder: str = "templates", static_folder: str = "static") -> Flask:
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

    app.config.setdefault("SEND_FILE_MAX_AGE_DEFAULT", 0)

    from .routes import blueprints
    for bp in blueprints:
        app.register_blueprint(bp)

    # Serve the userscript with the correct MIME type so Tampermonkey/Violentmonkey
    # on Chrome auto-detects it and shows the install dialog.
    @app.route("/tw-mail.user.js")
    def serve_userscript():
        return send_from_directory(
            os.path.join(app.root_path, static_folder),
            "tw-mail.user.js",
            mimetype="text/javascript",
        )

    return app
