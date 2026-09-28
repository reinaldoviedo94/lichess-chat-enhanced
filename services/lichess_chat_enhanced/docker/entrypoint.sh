#!/bin/sh
# Applied on every start, so a fresh volume and a restored volume behave the
# same. Migrations run here rather than in the workflow's SSH step so that a
# `docker compose up` on the server is a complete, reproducible deploy.
set -e

python manage.py migrate --noinput

if [ "${LCE_SEED_DEMO_PACKS:-true}" = "true" ]; then
    # Idempotent: safe to re-run on every deploy, keeps the free pack present.
    python manage.py seed_demo_packs
fi

exec "$@"
