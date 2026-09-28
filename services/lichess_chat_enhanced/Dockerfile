FROM python:3.14-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

RUN pip install --no-cache-dir uv

WORKDIR /app

# Dependencies first so an app-only change does not re-resolve the world.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev


FROM python:3.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    DJANGO_DEBUG=false \
    DB_PATH=/data/db.sqlite3 \
    MEDIA_ROOT=/data/media \
    EXTENSION_DIR=/extension

# Pillow needs the JPEG/zlib runtime; nothing here needs a compiler.
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        libjpeg62-turbo \
        zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged: the volume mounts are chowned to this user in the entrypoint.
RUN groupadd --system --gid 1000 app && \
    useradd --system --uid 1000 --gid app --home-dir /app app

WORKDIR /app

COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --chown=app:app . /app

RUN mkdir -p /data/media /extension && \
    chown -R app:app /data /extension && \
    chmod +x /app/docker/entrypoint.sh

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/', timeout=4).status == 200 else 1)"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
# gunicorn defaults to 127.0.0.1:8000, which is unreachable from outside the
# container: the published port maps to 0.0.0.0:8000, so bind explicitly.
# 2 workers is right for a 1 vCPU droplet that already runs ten containers.
# --no-control: the control server tries to write into the image filesystem,
# which is not writable for the unprivileged user, and we never use it.
CMD ["gunicorn", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--threads", "2", \
     "--timeout", "60", \
     "--access-logfile", "-", \
     "--no-control", \
     "lichess_chat_enhanced.wsgi:application"]
