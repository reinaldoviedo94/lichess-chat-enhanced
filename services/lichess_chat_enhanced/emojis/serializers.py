from rest_framework import serializers

from .models import Emoji, EmojiPack, UserEmojiPack


class EmojiSerializer(serializers.ModelSerializer):
    class Meta:
        model = Emoji
        fields = ('id', 'name', 'slug', 'image', 'emoji_type', 'order')


class EmojiPackSerializer(serializers.ModelSerializer):
    emojis = EmojiSerializer(many=True, read_only=True)

    class Meta:
        model = EmojiPack
        fields = ('id', 'name', 'slug', 'description', 'preview_image', 'is_free', 'price', 'emojis')


class EmojiPackListSerializer(serializers.ModelSerializer):
    emoji_count = serializers.IntegerField(source='emojis.count', read_only=True)

    class Meta:
        model = EmojiPack
        fields = ('id', 'name', 'slug', 'description', 'preview_image', 'is_free', 'price', 'emoji_count')


class UserEmojiPackSerializer(serializers.ModelSerializer):
    pack = EmojiPackSerializer(read_only=True)

    class Meta:
        model = UserEmojiPack
        fields = ('id', 'pack', 'acquired_at')
