from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from . import downloads

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/emojis/', include('emojis.urls')),
    path('api/health/', downloads.health, name='health'),
    path('', downloads.download_page, name='download-page'),
    path(
        'download/lichess-chat-enhanced.zip',
        downloads.download_extension,
        name='download-extension',
    ),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
