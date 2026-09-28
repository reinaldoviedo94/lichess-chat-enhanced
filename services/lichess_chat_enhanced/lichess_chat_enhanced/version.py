"""Single source of truth for the version strings the API reports.

The extension version is read from the packed extension's manifest at import
time when that build is mounted, and falls back to a placeholder otherwise,
so the API never invents a version the bundle does not claim.
"""

import json
import os
from pathlib import Path

from django.conf import settings

VERSION = os.environ.get('APP_VERSION', '0.1.0')

_DEFAULT_EXTENSION_VERSION = 'dev'


def _read_extension_version() -> str:
    manifest_name = os.environ.get('EXTENSION_MANIFEST_NAME', 'manifest.json')
    candidates = [
        Path(settings.EXTENSION_DIR) / manifest_name,
        Path(settings.BASE_DIR) / 'extension' / manifest_name,
    ]
    for candidate in candidates:
        try:
            manifest = json.loads(candidate.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(manifest, dict) and manifest.get('version'):
            return str(manifest['version'])
    return _DEFAULT_EXTENSION_VERSION


EXTENSION_VERSION = _read_extension_version()
