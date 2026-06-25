"""
fsub.py — Force subscription check
"""

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import ContextTypes
from telegram.error import BadRequest, Forbidden

import config
from script import fsub_text


async def check_fsub(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Returns True if the user is subscribed (or fsub not configured).
    Sends the join prompt and returns False if they aren't.
    """
    if not config.CHANNEL_LINK:
        return True  # fsub not configured

    user = update.effective_user
    if user is None:
        return True

    # Admins bypass fsub
    if user.id in config.ADMIN_IDS:
        return True

    # We need a numeric channel ID for getChatMember
    # CHANNEL_LINK may be https://t.me/channelname or https://t.me/+inviteHash
    # For getChatMember, we need @username or numeric ID.
    # Admins should set LOG_CHANNEL as the numeric ID of the fsub channel,
    # or we derive @username from CHANNEL_LINK.
    channel_ref = _channel_ref()
    if channel_ref is None:
        return True

    try:
        member = await context.bot.get_chat_member(channel_ref, user.id)
        if member.status in ("member", "administrator", "creator"):
            return True
    except (BadRequest, Forbidden):
        pass  # can't check → let through silently
    except Exception:
        pass

    # Not subscribed — send prompt
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(
            f"📢 Join {config.CHANNEL_NAME or 'Channel'}",
            url=config.CHANNEL_LINK,
        )],
        [InlineKeyboardButton("✅ Try Again", callback_data="fsub_check")],
    ])
    msg = update.effective_message
    if msg:
        await msg.reply_text(
            fsub_text(
                config.CHANNEL_NAME or "our channel",
                config.CHANNEL_LINK,
            ),
            reply_markup=keyboard,
            parse_mode="HTML",
        )
    return False


def _channel_ref() -> str | None:
    """Extract @username from CHANNEL_LINK, or return None."""
    link = config.CHANNEL_LINK.strip().rstrip("/")
    if not link:
        return None
    # https://t.me/username → @username
    if "t.me/" in link and not link.endswith("+"):
        slug = link.split("t.me/")[-1].split("?")[0]
        if not slug.startswith("+"):
            return "@" + slug
    # If a numeric LOG_CHANNEL is set, use that instead
    if config.LOG_CHANNEL:
        return str(config.LOG_CHANNEL)
    return None


async def fsub_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handles the 'Try Again' button press."""
    query = update.callback_query
    await query.answer()

    passed = await check_fsub(update, context)
    if passed:
        await query.edit_message_text("✅ You're subscribed! Send me a file to get started.")
    else:
        await query.answer("❌ Not subscribed yet — please join first.", show_alert=True)
  
