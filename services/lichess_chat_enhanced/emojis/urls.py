from django.urls import path

from . import views

app_name = 'emojis'

urlpatterns = [
    path('free/', views.FreePacksView.as_view(), name='free-packs'),
    path('my-packs/', views.MyPacksView.as_view(), name='my-packs'),
    path('store/', views.StorePacksView.as_view(), name='store-packs'),
    path('store/<slug:slug>/', views.StorePackDetailView.as_view(), name='store-pack-detail'),
    path('store/<slug:slug>/acquire/', views.AcquirePackView.as_view(), name='acquire-pack'),
]
