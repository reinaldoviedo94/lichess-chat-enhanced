"""Seed emoji packs with real image assets so the extension can be exercised end to end.

Idempotent: re-running updates the existing packs instead of duplicating them.

    uv run python manage.py seed_demo_packs
"""

import io
import json

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw

from emojis.models import Emoji, EmojiPack

# A 3-frame bounce, as a real Lottie JSON. The extension fetches this over
# FETCH_JSON and hands it to lottie-web, so it has to be valid animation data.
BOUNCE_LOTTIE = {
    "v": "5.7.4",
    "fr": 12,
    "ip": 0,
    "op": 36,
    "w": 64,
    "h": 64,
    "nm": "bounce",
    "ddd": 0,
    "assets": [],
    "layers": [
        {
            "ddd": 0,
            "ind": 1,
            "ty": 4,
            "nm": "ball",
            "sr": 1,
            "ks": {
                "o": {"a": 0, "k": 100},
                "r": {"a": 0, "k": 0},
                "p": {"a": 1, "k": [
                    {"t": 0, "s": [32, 12], "e": [32, 48], "i": {"x": [0.4], "y": [1]}, "o": {"x": [0.6], "y": [0]}},
                    {"t": 18, "s": [32, 48], "e": [32, 12], "i": {"x": [0.4], "y": [1]}, "o": {"x": [0.6], "y": [0]}},
                    {"t": 36, "s": [32, 12]},
                ]},
                "a": {"a": 0, "k": [0, 0, 0]},
                "s": {"a": 0, "k": [100, 100, 100]},
            },
            "ao": 0,
            "shapes": [
                {
                    "ty": "gr",
                    "it": [
                        {"ind": 0, "ty": "el", "s": {"a": 0, "k": [36, 36]}, "p": {"a": 0, "k": [0, 0]}, "nm": "Ellipse"},
                        {"ty": "fl", "c": {"a": 0, "k": [0.98, 0.55, 0.15, 1]}, "o": {"a": 0, "k": 100}, "r": 1, "nm": "Fill"},
                        {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100}},
                    ],
                    "nm": "ball-group",
                }
            ],
            "ip": 0,
            "op": 36,
            "st": 0,
            "bm": 0,
        }
    ],
}

# slug -> (label, rgb, glyph)
STATIC_EMOJIS = {
    "smile": ("Sonrisa", (255, 214, 79), "\u263A"),
    "cool": ("Guay", (129, 199, 212), "\U0001F60E"),
    "thinking": ("Pensando", (178, 170, 200), "\U0001F914"),
    "fire": ("Fuego", (240, 120, 90), "\U0001F525"),
    "clap": ("Aplauso", (150, 210, 160), "\U0001F44F"),
    "eyes": ("Ojos", (200, 200, 200), "\U0001F440"),
}

PAID_EMOJIS = {
    "crown": ("Corona", (240, 200, 90), "\U0001F451"),
    "rocket": ("Cohete", (110, 170, 240), "\U0001F680"),
    "trophy": ("Trofeo", (235, 180, 70), "\U0001F3C6"),
    "skull": ("Calavera", (200, 200, 210), "\U0001F480"),
}

PINK = (236, 120, 160)
PURPLE = (150, 130, 220)


def render_png(label, rgb, glyph, size=128):
    """Draw a rounded square with a glyph. Real pixels, so the picker has something to show."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([(4, 4), (size - 4, size - 4)], radius=24, fill=rgb + (255,))
    # Best-effort glyph placement: Pillow's default bitmap font is tiny, so scale
    # by drawing a filled disc behind a small centred glyph run.
    draw.ellipse([(size * 0.28, size * 0.28), (size * 0.72, size * 0.72)], fill=(255, 255, 255, 230))
    draw.text((size / 2 - 4, size / 2 - 6), glyph, fill=rgb + (255,))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class Command(BaseCommand):
    help = "Create demo emoji packs (one free, one paid) with real static and animated assets."

    def handle(self, *args, **options):
        self._seed_pack(
            slug="smileys",
            name="Smileys",
            description="Pack gratuito de prueba",
            is_free=True,
            price=0,
            color=PINK,
            catalogue=STATIC_EMOJIS,
        )
        self._seed_pack(
            slug="chess-plus",
            name="Chess Plus",
            description="Pack de pago de prueba",
            is_free=False,
            price="4.99",
            color=PURPLE,
            catalogue=PAID_EMOJIS,
        )
        self.stdout.write(self.style.SUCCESS("Listo."))
        self.stdout.write(f"MEDIA_ROOT: {settings.MEDIA_ROOT}")

    def _seed_pack(self, *, slug, name, description, is_free, price, color, catalogue):
        pack, created = EmojiPack.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "description": description,
                "is_free": is_free,
                "price": price,
            },
        )
        verb = "creado" if created else "actualizado"
        self.stdout.write(f"Pack {slug}: {verb}")

        for order, (emoji_slug, (label, rgb, glyph)) in enumerate(catalogue.items()):
            payload = render_png(label, rgb, glyph)
            emoji, _ = Emoji.objects.update_or_create(
                pack=pack,
                slug=emoji_slug,
                defaults={"name": label, "order": order, "emoji_type": Emoji.EmojiType.STATIC},
            )
            # Always rewrite: the generated pixels change if the renderer does.
            emoji.image.save(f"{slug}-{emoji_slug}.png", ContentFile(payload), save=True)

        # One animated emoji per pack exercises the FETCH_JSON + lottie-web path.
        animated_slug = "bounce"
        emoji, _ = Emoji.objects.update_or_create(
            pack=pack,
            slug=animated_slug,
            defaults={"name": "Rebote", "order": len(catalogue), "emoji_type": Emoji.EmojiType.ANIMATED},
        )
        emoji.image.save(
            f"{slug}-{animated_slug}.json",
            ContentFile(json.dumps(BOUNCE_LOTTIE).encode()),
            save=True,
        )
        self.stdout.write(f"  {len(catalogue)} estáticos + 1 animado ({animated_slug})")
