"""
db.py — MongoDB helpers for StreambotV2
"""
import time
import motor.motor_asyncio
from config import MONGO_URI

_client = None
_db = None

def get_db():
    global _client, _db
    if _db is None:
        _client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URI)
        _db = _client["streambotv2"]
    return _db

def col_files():    return get_db()["files"]
def col_users():    return get_db()["users"]
def col_channels(): return get_db()["channels"]
def col_banned():   return get_db()["banned"]
def col_settings(): return get_db()["settings"]
def col_counter():  return get_db()["counter"]
def col_fsub():     return get_db()["fsub"]

# ── Counter ───────────────────────────────────────────────────
async def next_seq() -> str:
    result = await col_counter().find_one_and_update(
        {"_id": "file_seq"}, {"$inc": {"val": 1}}, upsert=True, return_document=True)
    return str(result.get("val", 1)).zfill(6)

async def get_next_file_number() -> int:
    result = await col_counter().find_one_and_update(
        {"_id": "file_seq"}, {"$inc": {"val": 1}}, upsert=True, return_document=True)
    return result.get("val", 1)

# ── Files ─────────────────────────────────────────────────────
async def save_file(seq, file_id, file_unique_id, file_name, mime_type,
                    file_size, caption, uploader_id, channel_id, token, short_url):
    await col_files().insert_one({
        "_id": seq, "file_id": file_id, "file_unique_id": file_unique_id,
        "file_name": file_name, "mime_type": mime_type, "file_size": file_size,
        "caption": caption, "uploader_id": uploader_id, "channel_id": channel_id,
        "token": token, "short_url": short_url, "created_at": int(time.time()),
    })

async def get_file(seq): return await col_files().find_one({"_id": seq})
async def delete_file(seq): await col_files().delete_one({"_id": seq})
async def count_files(): return await col_files().count_documents({})

# ── Users ─────────────────────────────────────────────────────
async def get_user(user_id):
    doc = await col_users().find_one({"_id": user_id})
    return doc or {}

async def upsert_user(user_id, username, full_name) -> bool:
    existing = await col_users().find_one({"_id": user_id})
    await col_users().update_one(
        {"_id": user_id},
        {"$set": {"username": username, "full_name": full_name, "last_seen": int(time.time())},
         "$setOnInsert": {"joined_at": int(time.time())}},
        upsert=True,
    )
    return existing is None

async def set_user_field(user_id, key, value):
    await col_users().update_one({"_id": user_id}, {"$set": {key: value}}, upsert=True)

async def reset_user(user_id):
    await col_users().update_one({"_id": user_id}, {"$unset": {
        "caption_template": "", "shortener_url": "", "shortener_api_key": "",
        "shortener_enabled": "", "buttons_enabled": "", "upload_mode": "",
    }})

async def count_users(): return await col_users().count_documents({})
async def all_user_ids():
    return [doc["_id"] async for doc in col_users().find({}, {"_id": 1})]

# ── Channels ──────────────────────────────────────────────────
async def get_channel(chat_id): return await col_channels().find_one({"_id": chat_id})

async def add_channel(chat_id, title, username=None, added_by=None):
    await col_channels().update_one(
        {"_id": chat_id},
        {"$set": {"title": title, "username": username, "added_by": added_by,
                  "added_at": int(time.time())}},
        upsert=True,
    )

async def list_channels(added_by=None):
    q = {"added_by": added_by} if added_by else {}
    return [doc async for doc in col_channels().find(q)]

async def delete_channel(chat_id): await col_channels().delete_one({"_id": chat_id})
async def count_channels(): return await col_channels().count_documents({})

async def set_channel_field(chat_id, key, value):
    await col_channels().update_one({"_id": chat_id}, {"$set": {key: value}}, upsert=True)

async def reset_channel(chat_id):
    await col_channels().update_one({"_id": chat_id}, {"$unset": {
        "caption_template": "", "shortener_url": "", "shortener_api_key": "",
        "shortener_enabled": "", "buttons_enabled": "",
    }})

async def get_all_channels():
    return [doc async for doc in col_channels().find({})]

# ── Banned ────────────────────────────────────────────────────
async def ban_user(user_id, reason=""):
    await col_banned().update_one(
        {"_id": user_id}, {"$set": {"reason": reason, "banned_at": int(time.time())}}, upsert=True)

async def unban_user(user_id): await col_banned().delete_one({"_id": user_id})
async def is_banned(user_id): return await col_banned().find_one({"_id": user_id}) is not None
async def count_banned(): return await col_banned().count_documents({})

# ── Settings ──────────────────────────────────────────────────
async def get_setting(key, default=None):
    doc = await col_settings().find_one({"_id": key})
    return doc["value"] if doc else default

async def set_setting(key, value):
    await col_settings().update_one({"_id": key}, {"$set": {"value": value}}, upsert=True)

# ── Fsub ──────────────────────────────────────────────────────
async def get_fsub(): return await col_fsub().find_one({"_id": "fsub"})

async def set_fsub(chat_id, chat_title, chat_link, mode="normal"):
    await col_fsub().update_one(
        {"_id": "fsub"},
        {"$set": {"enabled": True, "chat_id": chat_id, "chat_title": chat_title,
                  "chat_link": chat_link, "mode": mode}},
        upsert=True,
    )

async def disable_fsub():
    await col_fsub().update_one({"_id": "fsub"}, {"$set": {"enabled": False}}, upsert=True)

async def has_join_request(user_id, chat_id):
    return await get_db()["join_requests"].find_one({"user_id": user_id, "chat_id": chat_id}) is not None

async def set_join_request(user_id, chat_id):
    await get_db()["join_requests"].update_one(
        {"user_id": user_id, "chat_id": chat_id},
        {"$set": {"at": int(time.time())}}, upsert=True)
