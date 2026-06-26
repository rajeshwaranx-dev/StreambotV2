"""
bot.py — StreambotV2 main bot
"""
import asyncio, base64, hashlib, hmac, json, logging
from datetime import datetime
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.constants import ParseMode
from telegram.error import Forbidden, BadRequest
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ChatJoinRequestHandler, ContextTypes, filters,
)
import config, db
from fsub import fsub_check, handle_fsub_callback, handle_join_request
from script import (
    START_TEXT, HELP_TEXT, ABOUT_TEXT,
    stats_text, new_user_log, new_channel_log, file_log,
    banned_text, unbanned_text, not_banned_text, broadcast_done,
)
from settings import (
    settings_cmd, settings_callback, get_handlers as settings_handlers,
    handle_settings_text, handle_add_channel,
    pending_text_filter, pending_add_filter, shorten_url,
)

logging.basicConfig(format="%(asctime)s | %(levelname)s | %(name)s | %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)


# ── Token helpers ─────────────────────────────────────────────
def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(data, separators=(",", ":")).encode()
    ).decode().rstrip("=")

def _make_token(seq, file_id, file_name, mime_type, file_size):
    safe_name = file_name.encode("ascii", "ignore").decode()[:60] or "file"
    meta = {"fileId": file_id, "fileName": safe_name, "mimeType": mime_type, "fileSize": file_size}
    return f"{seq}_{_b64(meta)}"

def _make_hash(token):
    return hmac.new(config.SECRET_KEY.encode(), token.encode(), hashlib.sha256).hexdigest()

def _make_urls(token):
    h   = _make_hash(token)
    seq = token.split("_")[0]
    watch    = f"{config.WORKER_URL}/watch/{seq}?hash={h}&theme={config.THEME}&token={token}"
    download = f"{config.WORKER_URL}/file/{seq}?hash={h}&token={token}"
    return watch, download

def _fmt(n):
    for u in ("B","KB","MB","GB"):
        if n < 1024: return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"

def _infer_name(msg):
    if msg.video: return f"video_{msg.message_id}.mp4"
    if msg.audio: return f"audio_{msg.message_id}.mp3"
    if msg.photo: return f"photo_{msg.message_id}.jpg"
    return f"file_{msg.message_id}"

def _infer_mime(msg):
    if msg.video: return "video/mp4"
    if msg.audio: return "audio/mpeg"
    if msg.photo: return "image/jpeg"
    return "application/octet-stream"

def admin_only(f):
    async def w(update, ctx):
        if update.effective_user.id not in config.ADMIN_IDS:
            await update.effective_message.reply_text("⛔ Admins only.")
            return
        return await f(update, ctx)
    w.__name__ = f.__name__
    return w


# ── Start / Help / About ──────────────────────────────────────
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user   = update.effective_user
    is_new = await db.upsert_user(user.id, user.username, user.full_name)

    if is_new and config.LOG_CHANNEL:
        total = await db.count_users()
        try:
            await ctx.bot.send_message(
                config.LOG_CHANNEL,
                new_user_log(user.id, user.full_name, user.username, total),
                parse_mode=ParseMode.HTML,
            )
        except Exception: pass

    text = START_TEXT.format(name=user.first_name)
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton(f"📢 Join {config.CHANNEL_NAME}", url=config.CHANNEL_LINK)]
        if config.CHANNEL_LINK else [],
        [InlineKeyboardButton("ℹ️ About",    callback_data="start:about"),
         InlineKeyboardButton("❓ Help",     callback_data="start:help")],
        [InlineKeyboardButton("⚙️ Settings", callback_data="start:settings")],
    ])
    # remove empty rows
    kb.inline_keyboard = [r for r in kb.inline_keyboard if r]

    msg = update.effective_message
    if config.START_IMAGE:
        try:
            await msg.reply_photo(config.START_IMAGE, caption=text, parse_mode=ParseMode.HTML, reply_markup=kb)
            return
        except Exception: pass
    await msg.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=kb)


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🏠 Home",  callback_data="start:home"),
         InlineKeyboardButton("ℹ️ About", callback_data="start:about")],
        [InlineKeyboardButton("❌ Close", callback_data="start:close")],
    ])
    await update.effective_message.reply_text(HELP_TEXT, parse_mode=ParseMode.HTML, reply_markup=kb)


async def start_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    async def _edit(text, kb):
        try: await q.edit_message_caption(caption=text, parse_mode=ParseMode.HTML, reply_markup=kb)
        except Exception:
            try: await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=kb)
            except Exception: pass

    home_kb = InlineKeyboardMarkup([
        [InlineKeyboardButton(f"📢 Join {config.CHANNEL_NAME}", url=config.CHANNEL_LINK)]
        if config.CHANNEL_LINK else [],
        [InlineKeyboardButton("ℹ️ About",    callback_data="start:about"),
         InlineKeyboardButton("❓ Help",     callback_data="start:help")],
        [InlineKeyboardButton("⚙️ Settings", callback_data="start:settings")],
    ])
    home_kb.inline_keyboard = [r for r in home_kb.inline_keyboard if r]

    if q.data == "start:home":
        text = START_TEXT.format(name=q.from_user.first_name)
        await _edit(text, home_kb)

    elif q.data == "start:help":
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🏠 Home",  callback_data="start:home"),
             InlineKeyboardButton("ℹ️ About", callback_data="start:about")],
            [InlineKeyboardButton("❌ Close", callback_data="start:close")],
        ])
        await _edit(HELP_TEXT, kb)

    elif q.data == "start:about":
        rows = []
        if config.SOURCE_CODE:
            rows.append([InlineKeyboardButton("📂 Source Code", url=config.SOURCE_CODE)])
        rows.append([
            InlineKeyboardButton("🏠 Home",  callback_data="start:home"),
            InlineKeyboardButton("❌ Close", callback_data="start:close"),
        ])
        text = ABOUT_TEXT.format(
            bot_name=config.BOT_NAME, developer=config.DEVELOPER,
            channel_name=config.CHANNEL_NAME, version=config.BOT_VERSION,
            hosting=config.BOT_HOSTING,
        )
        await _edit(text, InlineKeyboardMarkup(rows))

    elif q.data == "start:settings":
        from settings import _main_kb
        await _edit("⚙️ <b>SETTINGS</b>\n\nChoose what to configure:", _main_kb())

    elif q.data == "start:close":
        try: await q.delete_message()
        except Exception: pass


# ── Stats ─────────────────────────────────────────────────────
@admin_only
async def cmd_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = await db.count_users()
    f = await db.count_files()
    c = await db.count_channels()
    b = await db.count_banned()
    await update.effective_message.reply_text(
        stats_text(u, f, c, b, config.BOT_NAME, config.BOT_VERSION, config.BOT_HOSTING),
        parse_mode=ParseMode.HTML,
    )


# ── Ban / Unban ───────────────────────────────────────────────
@admin_only
async def cmd_ban(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    uid = None
    if ctx.args:
        try: uid = int(ctx.args[0])
        except ValueError: pass
    elif msg.reply_to_message:
        uid = msg.reply_to_message.from_user.id
    if not uid:
        await msg.reply_text("Usage: /ban <user_id>"); return
    reason = " ".join(ctx.args[1:]) if ctx.args and len(ctx.args) > 1 else ""
    await db.ban_user(uid, reason)
    await msg.reply_text(banned_text(uid), parse_mode=ParseMode.HTML)

@admin_only
async def cmd_unban(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    uid = None
    if ctx.args:
        try: uid = int(ctx.args[0])
        except ValueError: pass
    elif msg.reply_to_message:
        uid = msg.reply_to_message.from_user.id
    if not uid:
        await msg.reply_text("Usage: /unban <user_id>"); return
    if await db.is_banned(uid):
        await db.unban_user(uid)
        await msg.reply_text(unbanned_text(uid), parse_mode=ParseMode.HTML)
    else:
        await msg.reply_text(not_banned_text(uid), parse_mode=ParseMode.HTML)


# ── Fsub commands ─────────────────────────────────────────────
@admin_only
async def cmd_setfsub(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.effective_message.reply_text(
            "Usage: /setfsub <chat_id> <link> [mode]\nmode: normal or request")
        return
    chat_id = int(ctx.args[0])
    link    = ctx.args[1] if len(ctx.args) > 1 else ""
    mode    = ctx.args[2] if len(ctx.args) > 2 else "normal"
    try:
        chat = await ctx.bot.get_chat(chat_id)
        title = chat.title or str(chat_id)
    except Exception:
        title = str(chat_id)
    await db.set_fsub(chat_id, title, link, mode)
    await update.effective_message.reply_text(f"✅ Force-sub set to <b>{title}</b>", parse_mode=ParseMode.HTML)

@admin_only
async def cmd_removefsub(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await db.disable_fsub()
    await update.effective_message.reply_text("✅ Force-sub disabled.")

@admin_only
async def cmd_fsubstatus(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cfg = await db.get_fsub()
    if not cfg or not cfg.get("enabled"):
        await update.effective_message.reply_text("ℹ️ Force-sub is disabled.")
    else:
        await update.effective_message.reply_text(
            f"✅ Force-sub enabled\n"
            f"Channel: <b>{cfg.get('chat_title')}</b>\n"
            f"Mode: <code>{cfg.get('mode','normal')}</code>",
            parse_mode=ParseMode.HTML)


# ── Broadcast ─────────────────────────────────────────────────
@admin_only
async def cmd_broadcast(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    if not msg.reply_to_message:
        await msg.reply_text("Reply to a message to broadcast it."); return
    source   = msg.reply_to_message
    user_ids = await db.all_user_ids()
    sent = failed = 0
    status = await msg.reply_text(f"📣 Broadcasting to {len(user_ids):,} users…")
    for uid in user_ids:
        try:
            await source.copy(uid); sent += 1
        except (Forbidden, BadRequest): failed += 1
        except Exception: failed += 1
        if (sent + failed) % 50 == 0:
            try: await status.edit_text(f"📣 Progress: {sent+failed}/{len(user_ids)}")
            except Exception: pass
        await asyncio.sleep(0.05)
    await status.edit_text(broadcast_done(sent, failed), parse_mode=ParseMode.HTML)


# ── File handler ──────────────────────────────────────────────
async def handle_file(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    msg  = update.effective_message

    if await db.is_banned(user.id):
        await msg.reply_text("🚫 You are banned from this bot."); return

    if not await fsub_check(update, ctx):
        return

    await db.upsert_user(user.id, user.username, user.full_name)

    file_obj = msg.video or msg.audio or msg.document or (msg.photo[-1] if msg.photo else None)
    if not file_obj: return

    file_id       = file_obj.file_id
    file_unique_id= file_obj.file_unique_id
    file_size     = getattr(file_obj, "file_size", 0) or 0
    file_name     = getattr(file_obj, "file_name", None) or getattr(file_obj, "title", None) or _infer_name(msg)
    mime_type     = getattr(file_obj, "mime_type", None) or _infer_mime(msg)
    caption       = msg.caption or ""
    is_channel    = update.channel_post is not None

    proc = await msg.reply_text("⏳ Processing…")

    seq   = await db.next_seq()
    token = _make_token(seq, file_id, file_name, mime_type, file_size)
    watch_url, dl_url = _make_urls(token)

    # Per-user shortener
    short_url = watch_url
    if not is_channel:
        u = await db.get_user(user.id)
        if u.get("shortener_url") and u.get("shortener_enabled", True):
            short_url = await shorten_url(u["shortener_url"], u.get("shortener_api_key",""), watch_url)

    # Channel shortener
    if is_channel:
        ch = await db.get_channel(msg.chat.id)
        if ch and ch.get("shortener_url") and ch.get("shortener_enabled", True):
            short_url = await shorten_url(ch["shortener_url"], ch.get("shortener_api_key",""), watch_url)

    await db.save_file(
        seq=seq, file_id=file_id, file_unique_id=file_unique_id,
        file_name=file_name, mime_type=mime_type, file_size=file_size,
        caption=caption, uploader_id=user.id if user else 0,
        channel_id=msg.chat.id if is_channel else None,
        token=token, short_url=short_url,
    )

    size_str   = _fmt(file_size)
    is_video   = mime_type.startswith("video") if mime_type else False
    is_audio   = mime_type.startswith("audio") if mime_type else False

    # Determine upload mode
    if is_channel:
        ch = await db.get_channel(msg.chat.id)
        mode     = (ch or {}).get("upload_mode", "buttons")
        btns_on  = (ch or {}).get("buttons_enabled", True)
        tmpl     = (ch or {}).get("caption_template")
    else:
        u        = await db.get_user(user.id)
        mode     = u.get("upload_mode", "buttons")
        btns_on  = u.get("buttons_enabled", True)
        tmpl     = u.get("caption_template")

    if tmpl:
        reply_text = (tmpl
            .replace("{caption}", file_name).replace("{file_name}", file_name)
            .replace("{stream_link}", short_url).replace("{download_link}", dl_url)
            .replace("{size}", size_str).replace("{token}", token))
    else:
        icon = "🎬" if is_video else "🎵" if is_audio else "📄"
        reply_text = (
            f"{icon} <b>{file_name}</b>\n\n"
            f"📦 Size: <code>{size_str}</code>\n"
            f"🔑 Token: <code>{token}</code>"
        )

    kb = None
    if btns_on:
        watch_label = "▶️ Watch Online" if is_video else ("🎵 Play" if is_audio else "👁 View")
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton(watch_label, url=short_url),
             InlineKeyboardButton("📥 Download", url=dl_url)],
        ])

    await proc.delete()
    try:
        await msg.reply_text(reply_text, parse_mode=ParseMode.HTML, reply_markup=kb)
    except Exception:
        await msg.reply_text(reply_text, reply_markup=kb)

    # Log to log channel
    if config.LOG_CHANNEL:
        try:
            now = datetime.utcnow().strftime("%d %b %Y, %I:%M %p UTC")
            log_text = file_log(
                user.id if user else 0,
                user.username if user else None,
                user.full_name if user else "Channel",
                file_name, size_str, short_url, now,
            )
            log_kb = InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ Watch Online", url=short_url),
                 InlineKeyboardButton("📥 Download", url=dl_url)],
            ])
            await ctx.bot.send_message(config.LOG_CHANNEL, log_text,
                                       parse_mode=ParseMode.HTML, reply_markup=log_kb)
        except Exception as e:
            log.warning(f"Log channel error: {e}")


# ── Delete callback ───────────────────────────────────────────
async def handle_del_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if q.data.startswith("del:"):
        seq = q.data[4:]
        doc = await db.get_file(seq)
        if doc and doc.get("uploader_id") == q.from_user.id:
            await db.delete_file(seq)
            await q.edit_message_text("✅ File deleted.")
        else:
            await q.answer("❌ Cannot delete.", show_alert=True)


# ── App builder ───────────────────────────────────────────────
def build_app():
    app = Application.builder().token(config.BOT_TOKEN).build()

    app.add_handler(CommandHandler("start",       cmd_start))
    app.add_handler(CommandHandler("help",        cmd_help))
    app.add_handler(CommandHandler("stats",       cmd_stats))
    app.add_handler(CommandHandler("settings",    settings_cmd))
    app.add_handler(CommandHandler("ban",         cmd_ban))
    app.add_handler(CommandHandler("unban",       cmd_unban))
    app.add_handler(CommandHandler("broadcast",   cmd_broadcast))
    app.add_handler(CommandHandler("setfsub",     cmd_setfsub))
    app.add_handler(CommandHandler("removefsub",  cmd_removefsub))
    app.add_handler(CommandHandler("fsubstatus",  cmd_fsubstatus))

    app.add_handler(CallbackQueryHandler(start_callback,      pattern=r"^start:"))
    app.add_handler(CallbackQueryHandler(handle_fsub_callback,pattern=r"^fsub:"))
    app.add_handler(CallbackQueryHandler(handle_del_callback, pattern=r"^del:"))
    for h in settings_handlers():
        app.add_handler(h)

    app.add_handler(ChatJoinRequestHandler(handle_join_request))

    app.add_handler(MessageHandler(filters.FORWARDED & pending_add_filter, handle_add_channel))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND & pending_text_filter, handle_settings_text))

    app.add_handler(MessageHandler(
        (filters.ChatType.PRIVATE | filters.UpdateType.CHANNEL_POST) &
        (filters.VIDEO | filters.AUDIO | filters.Document.ALL | filters.PHOTO),
        handle_file,
    ))

    return app


if __name__ == "__main__":
    log.info("Starting StreambotV2…")
    build_app().run_polling(drop_pending_updates=True)
