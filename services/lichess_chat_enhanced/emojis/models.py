from django.conf import settings
from django.db import models


class EmojiPack(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    preview_image = models.ImageField(upload_to='packs/previews/', blank=True)
    is_free = models.BooleanField(default=False)
    price = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_free', 'name']

    def __str__(self):
        return self.name


class Emoji(models.Model):
    class EmojiType(models.TextChoices):
        STATIC = 'static', 'Static (PNG/WebP)'
        ANIMATED = 'animated', 'Animated (Lottie JSON)'

    pack = models.ForeignKey(EmojiPack, on_delete=models.CASCADE, related_name='emojis')
    name = models.CharField(max_length=100)
    slug = models.SlugField()
    image = models.FileField(upload_to='emojis/')
    emoji_type = models.CharField(
        max_length=10,
        choices=EmojiType.choices,
        default=EmojiType.STATIC,
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order']
        unique_together = [('pack', 'slug')]

    def __str__(self):
        return f'{self.pack.slug}:{self.name}'


class UserEmojiPack(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='emoji_packs')
    pack = models.ForeignKey(EmojiPack, on_delete=models.CASCADE, related_name='owners')
    acquired_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'pack')]

    def __str__(self):
        return f'{self.user} → {self.pack}'
