"""Local dev / WSGI entry point.

`flask --app app run` or `python app.py` for local development; the
container's process manager points at `app:app`
(spec/architecture.md, Tech stack).
"""
from solvent import create_app

app = create_app()

if __name__ == "__main__":
    app.run()
