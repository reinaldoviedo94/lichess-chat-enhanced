from django.contrib import admin

from .models import Emoji, EmojiPack, UserEmojiPack


class EmojiInline(admin.TabularInline):
    model = Emoji
    extra = 1


@admin.register(EmojiPack)
class EmojiPackAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_free', 'price', 'emoji_count', 'created_at')
    list_filter = ('is_free',)
    prepopulated_fields = {'slug': ('name',)}
    inlines = [EmojiInline]

    @admin.display(description='Emojis')
    def emoji_count(self, obj):
        return obj.emojis.count()


@admin.register(Emoji)
class EmojiAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'pack', 'emoji_type', 'order')
    list_filter = ('emoji_type', 'pack')


@admin.register(UserEmojiPack)
class UserEmojiPackAdmin(admin.ModelAdmin):
    list_display = ('user', 'pack', 'acquired_at')
    list_filter = ('pack',)
    raw_id_fields = ('user',)
