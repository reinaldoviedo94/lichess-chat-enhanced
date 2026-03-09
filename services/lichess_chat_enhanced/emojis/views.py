from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EmojiPack, UserEmojiPack
from .serializers import EmojiPackListSerializer, EmojiPackSerializer, UserEmojiPackSerializer


class FreePacksView(generics.ListAPIView):
    """Packs gratuitos — disponibles para todos, incluso sin auth."""
    queryset = EmojiPack.objects.filter(is_free=True).prefetch_related('emojis')
    serializer_class = EmojiPackSerializer
    permission_classes = (permissions.AllowAny,)


class StorePacksView(generics.ListAPIView):
    """Todos los packs disponibles en el store (sin emojis, solo preview)."""
    queryset = EmojiPack.objects.filter(is_free=False)
    serializer_class = EmojiPackListSerializer


class StorePackDetailView(generics.RetrieveAPIView):
    """Detalle de un pack del store con todos sus emojis."""
    queryset = EmojiPack.objects.prefetch_related('emojis')
    serializer_class = EmojiPackSerializer
    lookup_field = 'slug'


class MyPacksView(generics.ListAPIView):
    """Packs adquiridos por el usuario autenticado."""
    serializer_class = UserEmojiPackSerializer

    def get_queryset(self):
        return UserEmojiPack.objects.filter(user=self.request.user).select_related('pack').prefetch_related('pack__emojis')


class AcquirePackView(APIView):
    """Adquirir un pack (MVP: sin pago real)."""

    def post(self, request, slug):
        try:
            pack = EmojiPack.objects.get(slug=slug)
        except EmojiPack.DoesNotExist:
            return Response({'error': 'Pack not found'}, status=status.HTTP_404_NOT_FOUND)

        if pack.is_free:
            return Response({'error': 'This pack is already free for everyone'}, status=status.HTTP_400_BAD_REQUEST)

        _, created = UserEmojiPack.objects.get_or_create(user=request.user, pack=pack)

        if not created:
            return Response({'error': 'You already own this pack'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'status': 'acquired', 'pack': pack.slug}, status=status.HTTP_201_CREATED)
