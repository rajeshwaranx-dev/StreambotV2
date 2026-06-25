"""
config.py — loads all settings from .env
"""

import os
from dotenv import load_dotenv

load_dotenv()


def _req(key: str) -> str:
    v = os.getenv(key, "").strip()
    if not v:
        raise RuntimeError(f"Missing required env var: {key}")
    return v


def _list(key: str) -> list[int]:
    raw = os.getenv(key, "")
    return [int(x.strip()) for x in raw.split(",") if x.strip().lstrip("-").isdigit()]


# ── Telegram ──────────────────────────────────────────────────
BOT_TOKEN: str = _req("BOT_TOKEN")
API_ID: int = int(_req("API_ID"))
API_HASH: str = _req("API_HASH")
ADMIN_IDS: list[int] = _list("ADMIN_IDS")

# ── Database ──────────────────────────────────────────────────
MONGO_URI: str = _req("MONGO_URI")

# ── Worker ────────────────────────────────────────────────────
WORKER_URL: str = _req("WORKER_URL").rstrip("/")
SECRET_KEY: str = _req("SECRET_KEY")

# ── Channels ──────────────────────────────────────────────────
LOG_CHANNEL: int | None = int(os.getenv("LOG_CHANNEL", "0")) or None
CHANNEL_LINK: str = os.getenv("CHANNEL_LINK", "")
CHANNEL_NAME: str = os.getenv("CHANNEL_NAME", "")

# ── Branding ──────────────────────────────────────────────────
BOT_NAME: str = os.getenv("BOT_NAME", "StreamBot")
BOT_VERSION: str = os.getenv("BOT_VERSION", "v1.0.0")
BOT_HOSTING: str = os.getenv("BOT_HOSTING", "VPS + Cloudflare")
DEVELOPER: str = os.getenv("DEVELOPER", "")
SOURCE_CODE: str = os.getenv("SOURCE_CODE", "")
START_IMAGE: str = os.getenv("START_IMAGE", "")
THEME: str = os.getenv("THEME", "dark_gold")
DISCLAIMER_TEXT: str = os.getenv("DISCLAIMER_TEXT", "")
BRAND_PRIMARY: str = os.getenv("BRAND_PRIMARY", "")
BRAND_ACCENT: str = os.getenv("BRAND_ACCENT", "")
BRAND_TAGLINE: str = os.getenv("BRAND_TAGLINE", "")

# ── Upload mode ───────────────────────────────────────────────
# "files"   → send the stream link as a text message
# "buttons" → send inline keyboard buttons (Watch / Download)
UPLOAD_MODE: str = os.getenv("UPLOAD_MODE", "buttons")

