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

# The image carries its own hardening, so an install that sets no
# container option still has it (architecture.md, Tech stack, Container
# hardening). No file can raise a process to root, and /data is the one
# path in the image its user can write. The user is a number,
# so a platform can verify it is not root, and no account or home
# directory exists for it.
RUN find / -xdev ! -user 0 -exec chown -h 0:0 {} + \
 && find / -xdev -type f -perm /6000 -exec chmod ug-s {} + \
 && find / -xdev ! -type l -perm /0022 -exec chmod go-w {} + \
 && mkdir -m 775 /data \
 && chgrp 10001 /data
USER 10001:10001
VOLUME ["/data"]

EXPOSE 8000

# One gthread process with 8 request threads (architecture.md, WSGI
# server): a lookup waiting on a slow price source holds one thread, not
# the whole instance, and one process keeps every in-process bound
# instance-wide.
# --worker-tmp-dir /dev/shm: the worker heartbeat file needs a writable
# directory, and /dev/shm is the one tmpfs a read-only container always
# has. --no-control-socket: the control socket would be the second such
# path, under $HOME, and nothing here drives gunicorn over it.
# --access-logformat: no peer address, user agent or referrer, and the
# path without its query, so no invite token reaches the log
# (architecture.md, Storage & data handling).
# --config python:solvent.server: Solvent answers a request gunicorn
# cannot read with its own page and headers, and logs no address or URI
# for it (app-shell.md, Error pages).
# --log-level error: gunicorn's own lines below ERROR can carry the
# peer's address (architecture.md, Storage & data handling).
CMD ["gunicorn", \
     "--config", "python:solvent.server", \
     "--bind", "0.0.0.0:8000", \
     "--worker-class", "gthread", \
     "--workers", "1", \
     "--threads", "8", \
     "--worker-tmp-dir", "/dev/shm", \
     "--no-control-socket", \
     "--access-logfile", "-", \
     "--access-logformat", "%(t)s \"%(m)s %(U)s\" %(s)s %(b)s %(M)s", \
     "--log-level", "error", \
     "app:app"]
