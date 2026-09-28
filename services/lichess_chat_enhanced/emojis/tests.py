from django.contrib.auth import get_user_model
from django.urls import reverse
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from emojis.models import EmojiPack, UserEmojiPack

User = get_user_model()


class CORSConfigurationTests(APITestCase):
    """Issue #3: CORS no debe abrirse a cualquier origen por defecto."""

    def setUp(self):
        self.free = EmojiPack.objects.create(name='G', slug='g1', is_free=True)

    def get_with_origin(self, origin):
        return self.client.get('/api/emojis/free/', HTTP_ORIGIN=origin)

    def test_default_rejects_unknown_origin(self):
        """Con la config por defecto (allow_all=false) un origen ajeno no recibe ACAO."""
        response = self.get_with_origin('https://evil.example')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.has_header('Access-Control-Allow-Origin'))

    @override_settings(
        CORS_ALLOW_ALL_ORIGINS=False,
        CORS_ALLOWED_ORIGINS=['https://app.example'],
    )
    def test_configured_origin_is_echoed(self):
        response = self.get_with_origin('https://app.example')
        self.assertEqual(
            response.headers.get('Access-Control-Allow-Origin'), 'https://app.example'
        )

    @override_settings(CORS_ALLOW_ALL_ORIGINS=True)
    def test_explicit_wildcard_still_works_when_requested(self):
        """Si un despliegue realmente pide wildcard, sigue funcionando (env opt-in)."""
        response = self.get_with_origin('https://whatever.example')
        self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), '*')


class AcquirePackViewTests(APITestCase):
    """Issue #4: la capa de adquisición de packs no era testeable ni estaba testada."""

    def setUp(self):
        self.user = User.objects.create_user(username='buyer', password='pw')
        self.free_pack = EmojiPack.objects.create(
            name='Gratis', slug='free-pack', is_free=True, price=0
        )
        self.store_pack = EmojiPack.objects.create(
            name='Premium', slug='premium-pack', is_free=False, price=2.99
        )

    def acquire(self, slug):
        self.client.force_authenticate(self.user)
        return self.client.post(reverse('emojis:acquire-pack', kwargs={'slug': slug}))

    def test_success_acquires_pack_and_returns_201(self):
        """Ser feliz: un pack de pago se adquiere y queda asociado al usuario."""
        response = self.acquire('premium-pack')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            UserEmojiPack.objects.filter(user=self.user, pack=self.store_pack).exists()
        )

    def test_free_pack_rejected_with_400(self):
        """Un pack gratuito no se puede 'adquirir': ya es de todos."""
        response = self.acquire('free-pack')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            UserEmojiPack.objects.filter(user=self.user, pack=self.free_pack).exists()
        )

    def test_duplicate_acquire_rejected_with_400(self):
        """Adquirir dos veces el mismo pack no debe duplicar la relación."""
        self.client.force_authenticate(self.user)
        self.client.post(reverse('emojis:acquire-pack', kwargs={'slug': 'premium-pack'}))

        response = self.acquire('premium-pack')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            UserEmojiPack.objects.filter(user=self.user, pack=self.store_pack).count(),
            1,
        )

    def test_unknown_pack_returns_404(self):
        response = self.acquire('does-not-exist')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_requires_authentication(self):
        """Sin un usuario autenticado, endpooint devuelve 401 (correcto para una vista protegida)."""
        response = self.client.post(
            reverse('emojis:acquire-pack', kwargs={'slug': 'premium-pack'})
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class StorePackDetailTests(APITestCase):
    def setUp(self):
        user = User.objects.create_user(username='viewer', password='pw')
        self.client.force_authenticate(user)
        self.pack = EmojiPack.objects.create(name='Detalle', slug='detail', is_free=False, price=9.99)

    def test_detail_serializes_emojis(self):
        response = self.client.get(reverse('emojis:store-pack-detail', kwargs={'slug': 'detail'}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['slug'], 'detail')
        self.assertIn('emojis', response.data)