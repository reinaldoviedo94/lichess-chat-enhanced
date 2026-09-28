"""Serves the packaged Chrome extension and its install page.

The zip is produced by the extension build in CI and mounted read-only, so
Django never has to know how the bundle is assembled. A missing zip is a
normal state (fresh deploy before the first build lands) and is reported as
503 rather than a 500, so the healthcheck stays honest about it.
"""

from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.cache import never_cache

from .version import EXTENSION_VERSION, VERSION


def _zip_path():
    return settings.EXTENSION_DIR / settings.EXTENSION_ZIP_NAME


@never_cache
def health(request):
    """Liveness for the container healthcheck and for uptime checks."""
    zip_path = _zip_path()
    return JsonResponse(
        {
            'status': 'ok',
            'version': VERSION,
            'extension_version': EXTENSION_VERSION,
            'extension_packaged': zip_path.exists(),
        }
    )


@never_cache
def download_page(request):
    zip_path = _zip_path()
    return render(
        request,
        'download.html',
        {
            'origin': settings.PUBLIC_ORIGIN,
            'version': VERSION,
            'extension_version': EXTENSION_VERSION,
            'packaged': zip_path.exists(),
            'size_kb': round(zip_path.stat().st_size / 1024) if zip_path.exists() else 0,
        },
    )


@never_cache
def download_extension(request):
    zip_path = _zip_path()
    if not zip_path.exists():
        return HttpResponse(
            'Extension bundle not available yet.',
            status=503,
            content_type='text/plain',
        )
    response = FileResponse(
        zip_path.open('rb'),
        content_type='application/zip',
    )
    response['Content-Length'] = zip_path.stat().st_size
    response['Content-Disposition'] = (
        f'attachment; filename="{settings.EXTENSION_ZIP_NAME}"'
    )
    return response
