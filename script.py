"""
script.py — All message templates for StreambotV2
Style: matched to reference bot with our branding
"""

# ── Start ─────────────────────────────────────────────────────
START_TEXT = (
    "👋 <b>Hello {name}!</b>\n\n"
    "I'm a powerful <b>File to Link & Stream Bot</b> "
    "with <b>4GB+ support</b> 🤖\n\n"
    "📤 <b>What I can do:</b>\n"
    "┣ Generate stream & download links\n"
    "┣ Support files up to <b>4GB</b>\n"
    "┣ Custom captions & shorteners\n"
    "┣ Channel file automation\n"
    "┗ Force subscription support\n\n"
    "🚀 Send me any file to get started!"
)

# ── Help ──────────────────────────────────────────────────────
HELP_TEXT = (
    "📖 <b>Help & Commands</b>\n\n"
    "┣ /start — Welcome message\n"
    "┣ /help — This message\n"
    "┣ /stats — Bot statistics (admin)\n"
    "┣ /broadcast — Broadcast message (admin)\n"
    "┣ /ban &lt;id&gt; — Ban a user (admin)\n"
    "┣ /unban &lt;id&gt; — Unban a user (admin)\n"
    "┣ /settings — Manage your settings\n\n"
    "<b>⚙️ Settings Features:</b>\n"
    "┣ Custom caption template\n"
    "┣ URL shortener integration\n"
    "┣ Upload mode (Files/Buttons)\n"
    "┗ Channel management\n\n"
    "<b>📦 Supported:</b>\n"
    "┣ Files up to <b>4GB</b> ✅\n"
    "┗ Video, Audio, Documents, Photos\n\n"
    "<b>🔖 Caption Placeholders:</b>\n"
    "<code>{caption}</code> — file name\n"
    "<code>{stream_link}</code> — watch URL\n"
    "<code>{download_link}</code> — download URL\n"
    "<code>{size}</code> — file size\n"
    "<code>{token}</code> — token"
)

# ── About ─────────────────────────────────────────────────────
ABOUT_TEXT = (
    "🤖 <b>Bot Information</b>\n\n"
    "┌─── <b>Bot Details</b> ───┐\n"
    "┣ 📝 Name: <b>{bot_name}</b>\n"
    "┣ 👨‍💻 Developer: {developer}\n"
    "┣ 📢 Updates: {channel_name}\n"
    "└─────────────────────┘\n\n"
    "┌─── <b>Technical Specs</b> ───┐\n"
    "┣ 📦 Version: <b>{version}</b>\n"
    "┣ 🐍 Python: <b>3.12</b>\n"
    "┣ 🔧 Framework: <b>PTB 20.7</b>\n"
    "┣ 🗄 Database: <b>MongoDB</b>\n"
    "┗ ☁️ Hosted on: <b>{hosting}</b>\n\n"
    "⚡️ Built with ❤️ by {developer}"
)

# ── Stats ─────────────────────────────────────────────────────
def stats_text(users, files, channels, banned, bot_name, version, hosting):
    return (
        f"📊 <b>{bot_name} Statistics</b>\n\n"
        f"┌─── <b>Usage</b> ───┐\n"
        f"┣ 👤 Users: <b>{users:,}</b>\n"
        f"┣ 📁 Files: <b>{files:,}</b>\n"
        f"┣ 📢 Channels: <b>{channels:,}</b>\n"
        f"┗ 🚫 Banned: <b>{banned:,}</b>\n\n"
        f"┌─── <b>System</b> ───┐\n"
        f"┣ 📦 Version: <code>{version}</code>\n"
        f"┗ ☁️ Hosting: <code>{hosting}</code>"
    )

# ── New user log ──────────────────────────────────────────────
def new_user_log(user_id, full_name, username, total_users):
    uname = f"@{username}" if username else "no username"
    return (
        f"👤 <b>New User</b>\n\n"
        f"┣ Name: <b>{full_name}</b>\n"
        f"┣ Username: {uname}\n"
        f"┣ ID: <code>{user_id}</code>\n"
        f"┗ Total Users: <b>{total_users:,}</b>"
    )

# ── New channel log ───────────────────────────────────────────
def new_channel_log(channel_id, channel_title, added_by):
    return (
        f"📢 <b>Channel Connected</b>\n\n"
        f"┣ Title: <b>{channel_title}</b>\n"
        f"┣ ID: <code>{channel_id}</code>\n"
        f"┗ Added by: <code>{added_by}</code>"
    )

# ── File upload log ───────────────────────────────────────────
def file_log(user_id, username, full_name, file_name, size_str, watch_url, now):
    uname = f"@{username}" if username else "no username"
    return (
        f"📤 <b>File Upload</b>\n\n"
        f"┣ 👤 User: <b>{full_name}</b> ({uname})\n"
        f"┣ 🆔 ID: <code>{user_id}</code>\n"
        f"┣ 📄 File: <b>{file_name}</b>\n"
        f"┣ 📦 Size: <code>{size_str}</code>\n"
        f"┣ 🔗 Link: {watch_url}\n"
        f"┗ ⏰ Time: {now}"
    )

# ── Ban / Unban ───────────────────────────────────────────────
def banned_text(user_id):
    return f"🚫 User <code>{user_id}</code> has been <b>banned</b>."

def unbanned_text(user_id):
    return f"✅ User <code>{user_id}</code> has been <b>unbanned</b>."

def not_banned_text(user_id):
    return f"ℹ️ User <code>{user_id}</code> is <b>not banned</b>."

# ── Broadcast ─────────────────────────────────────────────────
def broadcast_done(sent, failed):
    return (
        f"📣 <b>Broadcast Complete</b>\n\n"
        f"┣ ✅ Sent: <b>{sent:,}</b>\n"
        f"┗ ❌ Failed: <b>{failed:,}</b>"
    )

# ── Fsub ─────────────────────────────────────────────────────
def fsub_text(channel_name, join_label):
    return (
        f"👋 <b>Welcome!</b>\n\n"
        f"⚠️ You must join <b>{channel_name}</b> to use this bot.\n\n"
        f"1️⃣ Click <b>{join_label}</b> below\n"
        f"2️⃣ Come back and tap <b>✅ I Joined</b>"
    )

# ── PM note ───────────────────────────────────────────────────
PM_NOTE = (
    "\n\n━━━━━━━━━━━━━━━━━━\n"
    "❤️ Join {channel_name} for more!\n"
    "🔗 {channel_link}"
)

# ── Caption template help ─────────────────────────────────────
CAPTION_HELP = (
    "📝 <b>Caption Template</b>\n\n"
    "Placeholders:\n"
    "<code>{caption}</code> — file name\n"
    "<code>{stream_link}</code> — watch URL\n"
    "<code>{download_link}</code> — download URL\n"
    "<code>{size}</code> — file size\n"
    "<code>{token}</code> — token\n\n"
    "HTML supported: <code>&lt;b&gt;bold&lt;/b&gt;</code>, "
    "<code>&lt;i&gt;italic&lt;/i&gt;</code>, "
    "<code>&lt;code&gt;mono&lt;/code&gt;</code>"
    )
