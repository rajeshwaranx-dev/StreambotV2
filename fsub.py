"""
fsub.py — Force subscription for StreambotV2
"""
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
import db
from script import fsub_text

logger = logging.getLogger(__name__)
pending_files: dict[int, dict] = {}


async def fsub_check(update: Update, ctx: ContextTypes.DEFAULT_TYPE, pending_data: dict = None) -> bool:
    cfg = await db.get_fsub()
    if not cfg or not cfg.get("enabled"):
        return True
    msg = update.message or update.channel_post
    if not msg:
        return True
    uid = update.effective_user.id if update.effective_user else None
    if uid is None:
        return True

    import config
    if uid in config.ADMIN_IDS:
        return True

    chat_id = cfg["chat_id"]
    mode    = cfg.get("mode", "normal")

    if await _is_subscribed(ctx.bot, uid, chat_id, mode):
        return True

    if pending_data:
        pending_files[uid] = pending_data

    chat_link  = cfg.get("chat_link", "")
    chat_name  = cfg.get("chat_title", "our channel")
    join_label = "📨 Request to Join" if mode == "request" else "📢 Join Channel"

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton(join_label, url=chat_link)],
        [InlineKeyboardButton("✅ I Joined", callback_data=f"fsub:check:{chat_id}")],
    ])
    await msg.reply_text(
        fsub_text(chat_name, join_label),
        parse_mode="HTML",
        reply_markup=kb,
    )
    return False


async def _is_subscribed(bot, uid: int, chat_id: int, mode: str) -> bool:
    try:
        member = await bot.get_chat_member(chat_id, uid)
        status = member.status
        if status in ("member", "administrator", "creator"):
            return True
        if status == "restricted":
            return True
        if status == "kicked":
            return False
        if mode == "request":
            return await db.has_join_request(uid, chat_id)
        return False
    except Exception as e:
        logger.warning(f"[FSUB] check error uid={uid}: {e}")
        return True  # fail open


async def handle_fsub_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q       = update.callback_query
    uid     = q.from_user.id
    chat_id = int(q.data.split(":")[2])
    await q.answer()

    cfg  = await db.get_fsub() or {}
    mode = cfg.get("mode", "normal")

    if await _is_subscribed(ctx.bot, uid, chat_id, mode):
        pdata = pending_files.pop(uid, None)
        try:
            await q.edit_message_text("✅ <b>Access granted!</b> Send me a file to get started.", parse_mode="HTML")
        except Exception:
            pass
        return

    chat_link  = cfg.get("chat_link", "")
    chat_name  = cfg.get("chat_title", "our channel")
    join_label = "📨 Request to Join" if mode == "request" else "📢 Join Channel"
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton(join_label, url=chat_link)],
        [InlineKeyboardButton("✅ I Joined", callback_data=f"fsub:check:{chat_id}")],
    ])
    try:
        await q.edit_message_text(
            f"❌ <b>Not verified!</b>\n\nPlease join <b>{chat_name}</b> first.",
            parse_mode="HTML", reply_markup=kb)
    except Exception:
        pass


async def handle_join_request(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    req = update.chat_join_request
    if req:
        await db.set_join_request(req.from_user.id, req.chat.id)
