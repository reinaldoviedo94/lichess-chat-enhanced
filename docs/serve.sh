#!/usr/bin/env bash
# Sirve docs/ en http://127.0.0.1:8848 para ver el diagrama de arquitectura.
# El HTML de archify es standalone; esto solo evita depender del file:// del navegador.
set -euo pipefail

PORT="${PORT:-8848}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "→ http://127.0.0.1:${PORT}/architecture.html"
echo "→ http://127.0.0.1:${PORT}/tooljet.html   (plano ToolJet)"
echo "  Ctrl+C para detener."

exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR"
