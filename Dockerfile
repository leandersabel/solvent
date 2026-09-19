# The deployment image (spec/architecture.md, Tech stack). Pinned by
# digest, not by tag, so a rebuild is the same base until Dependabot
# moves the digest deliberately.
FROM python:3.13-slim@sha256:8d9d0b8bcf6506481eae4907c18f5e3e7902e629f5f6d684f9e7c32e85e3ddf0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DATABASE_PATH=/data/solvent.db

WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app.py ./
COPY solvent ./solvent

# Non-root, and the writable volume is the only path it owns. The root
# filesystem is mounted read-only at run time (architecture.md, Tech
# stack, Container hardening); nothing in the image is written to.
RUN useradd --create-home --uid 10001 solvent \
 && mkdir -p /data \
 && chown solvent:solvent /data
USER solvent
VOLUME ["/data"]

EXPOSE 8000

# --worker-tmp-dir /dev/shm: the worker heartbeat file needs a writable
# directory, and /dev/shm is the one tmpfs a read-only container always
# has. --no-control-socket: the control socket would be the second such
# path, under $HOME, and nothing here drives gunicorn over it.
CMD ["gunicorn", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--worker-tmp-dir", "/dev/shm", \
     "--no-control-socket", \
     "--access-logfile", "-", \
     "app:app"]
