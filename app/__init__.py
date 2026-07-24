from flask import Flask


def create_app(template_folder: str = "templates", static_folder: str = "static") -> Flask:
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

    from .routes import blueprints
    for bp in blueprints:
        app.register_blueprint(bp)

    return app
