"""
script.py — all user-facing message templates
"""

from config import (
    BOT_NAME, BOT_VERSION, BOT_HOSTING,
    DEVELOPER, SOURCE_CODE, CHANNEL_LINK,
    CHANNEL_NAME, DISCLAIMER_TEXT, BRAND_TAGLINE,
)


# ── Start ─────────────────────────────────────────────────────
def start_text(full_name: str) -> str:
    tagline = BRAND_TAGLINE or "Stream anything. Share instantly."
    return (
        f"👋 <b>Hey {full_name}!</b>\n\n"
        f"Welcome to <b>{BOT_NAME}</b> — {tagline}\n\n"
        f"📤 <b>Send me any file</b> (video, audio, document, photo) "
        f"and I'll give you a permanent streaming link powered by Cloudflare.\n\n"
        f"🔒 Links are hash-protected.\n"
        f"⚡ No VPS tunnels — streams directly through the edge.\n\n"
        + (f"📢 Join <a href='{CHANNEL_LINK}'>{CHANNEL_NAME}</a> for updates.\n\n"
           if CHANNEL_LINK else "")
        + f"<i>/help for all commands</i>"
    )


# ── Help ──────────────────────────────────────────────────────
HELP_TEXT = (
    "📖 <b>Commands</b>\n\n"
    "• /start — Welcome message\n"
    "• /help — Show this list\n"
    "• /stats — Bot statistics\n"
    "• /settings — Bot settings (admin)\n"
    "• /broadcast — Broadcast a message (admin)\n"
    "• /ban &lt;user_id&gt; — Ban a user (admin)\n"
    "• /unban &lt;user_id&gt; — Unban a user (admin)\n"
    "• /addchannel — Connect a channel (admin)\n"
    "• /delchannel — Disconnect a channel (admin)\n\n"
    "📤 <b>Usage:</b> Forward or send any file — I'll reply with the stream link."
)


# ── Stats ─────────────────────────────────────────────────────
def stats_text(users: int, files: int, channels: int, banned: int) -> str:
    return (
        f"📊 <b>{BOT_NAME} Stats</b>\n\n"
        f"👤 Users: <b>{users:,}</b>\n"
        f"📁 Files indexed: <b>{files:,}</b>\n"
        f"📢 Connected channels: <b>{channels:,}</b>\n"
        f"🚫 Banned users: <b>{banned:,}</b>\n\n"
        f"🤖 Version: <code>{BOT_VERSION}</code>\n"
        f"🖥 Hosting: <code>{BOT_HOSTING}</code>"
    )


# ── File link (text mode) ─────────────────────────────────────
def file_link_text(file_name: str, watch_url: str, download_url: str,
                   file_size_str: str, caption: str = "") -> str:
    body = (
        f"✅ <b>File Processed</b>\n\n"
        f"📄 <b>{file_name}</b>\n"
        f"📦 Size: {file_size_str}\n\n"
        f"🔗 <b>Stream:</b> <code>{watch_url}</code>\n"
        f"⬇️ <b>Download:</b> <code>{download_url}</code>"
    )
    if caption:
        body += f"\n\n📝 <i>{caption}</i>"
    if DISCLAIMER_TEXT:
        body += f"\n\n⚠️ <i>{DISCLAIMER_TEXT}</i>"
    return body


# ── New user log ──────────────────────────────────────────────
def new_user_log(user_id: int, full_name: str, username: str | None,
                 total_users: int) -> str:
    uname = f"@{username}" if username else "no username"
    return (
        f"👤 <b>New User</b>\n\n"
        f"ID: <code>{user_id}</code>\n"
        f"Name: {full_name}\n"
        f"Username: {uname}\n\n"
        f"Total users: <b>{total_users:,}</b>"
    )


# ── New channel log ───────────────────────────────────────────
def new_channel_log(channel_id: int, channel_title: str, added_by: int) -> str:
    return (
        f"📢 <b>Channel Connected</b>\n\n"
        f"ID: <code>{channel_id}</code>\n"
        f"Title: {channel_title}\n"
        f"Added by: <code>{added_by}</code>"
    )


# ── Ban / Unban ───────────────────────────────────────────────
def banned_text(user_id: int) -> str:
    return f"🚫 User <code>{user_id}</code> has been banned."


def unbanned_text(user_id: int) -> str:
    return f"✅ User <code>{user_id}</code> has been unbanned."


def not_banned_text(user_id: int) -> str:
    return f"ℹ️ User <code>{user_id}</code> is not banned."


# ── Force-sub ─────────────────────────────────────────────────
def fsub_text(channel_name: str, channel_link: str) -> str:
    return (
        f"🔒 <b>Access Required</b>\n\n"
        f"Please join <a href='{channel_link}'>{channel_name}</a> "
        f"to use this bot, then tap <b>Try Again</b>."
    )


# ── Broadcast ─────────────────────────────────────────────────
def broadcast_done(sent: int, failed: int) -> str:
    return (
        f"📣 <b>Broadcast complete</b>\n\n"
        f"✅ Sent: <b>{sent:,}</b>\n"
        f"❌ Failed: <b>{failed:,}</b>"
    )


# ── About ─────────────────────────────────────────────────────
def about_text() -> str:
    lines = [
        f"ℹ️ <b>About {BOT_NAME}</b>\n",
        f"Version: <code>{BOT_VERSION}</code>",
        f"Hosting: <code>{BOT_HOSTING}</code>",
    ]
    if DEVELOPER:
        lines.append(f"Developer: {DEVELOPER}")
    if SOURCE_CODE:
        lines.append(f"Source: <a href='{SOURCE_CODE}'>GitHub</a>")
    return "\n".join(lines)

