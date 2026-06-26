"""
stream_server.py — FastAPI + Pyrogram stream server
Runs on VPS port 8080, streams files directly from Telegram
Supports range requests and files up to 4GB+
"""
import asyncio
import hashlib
import hmac
import logging
import math
import base64
import json
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, Response

from pyrogram import Client
from pyrogram.errors import FloodWait

import config

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI()

# ── Pyrogram client ───────────────────────────────────────────
pyro: Client | None = None

async def get_client() -> Client:
    global pyro
    if pyro is None or not pyro.is_connected:
        pyro = Client(
            "stream_session",
            api_id=config.API_ID,
            api_hash=config.API_HASH,
            bot_token=config.BOT_TOKEN,
            workdir="/root/StreambotV2",
        )
        await pyro.start()
        log.info("Pyrogram client started")
    return pyro


# ── HMAC verification ─────────────────────────────────────────
def verify_hash(token: str, hash_val: str) -> bool:
    expected = hmac.new(
        config.SECRET_KEY.encode(),
        token.encode(),
        hashlib.sha256,
    ).hexdigest()
    return expected == hash_val


# ── Token decode ──────────────────────────────────────────────
def decode_token(token: str) -> dict | None:
    try:
        idx = token.index("_")
        b64 = token[idx + 1:]
        pad = b64 + "==" * ((4 - len(b64) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(pad))
    except Exception:
        return None


# ── Chunk size ────────────────────────────────────────────────
CHUNK_SIZE = 1024 * 1024  # 1MB chunks


async def stream_file(
    client: Client,
    file_id: str,
    file_size: int,
    offset: int = 0,
    limit: int = -1,
) -> AsyncGenerator[bytes, None]:
    """Stream file from Telegram in chunks."""
    current = offset
    end = file_size if limit == -1 else min(offset + limit, file_size)

    async for chunk in client.stream_media(
        file_id,
        limit=math.ceil((end - offset) / CHUNK_SIZE),
        offset=math.floor(offset / CHUNK_SIZE),
    ):
        # Trim first chunk if offset is mid-chunk
        if current == offset and offset % CHUNK_SIZE != 0:
            skip = offset % CHUNK_SIZE
            chunk = chunk[skip:]
        # Trim last chunk
        remaining = end - current
        if len(chunk) > remaining:
            chunk = chunk[:remaining]
        if not chunk:
            break
        yield chunk
        current += len(chunk)
        if current >= end:
            break


# ── /stream/:token ────────────────────────────────────────────
@app.get("/stream/{seq}")
async def stream_endpoint(seq: str, request: Request):
    token = request.query_params.get("token", "")
    hash_val = request.query_params.get("hash", "")

    if not verify_hash(token, hash_val):
        raise HTTPException(status_code=403, detail="Forbidden")

    meta = decode_token(token)
    if not meta or not meta.get("fileId"):
        raise HTTPException(status_code=400, detail="Bad token")

    file_id   = meta["fileId"]
    file_size = meta.get("fileSize", 0)
    mime_type = meta.get("mimeType", "application/octet-stream")
    file_name = meta.get("fileName", "file")

    if not file_size:
        raise HTTPException(status_code=400, detail="Unknown file size")

    client = await get_client()

    # Range request handling
    range_header = request.headers.get("Range")
    start = 0
    end   = file_size - 1
    status_code = 200

    if range_header:
        try:
            range_val = range_header.replace("bytes=", "")
            parts     = range_val.split("-")
            start     = int(parts[0]) if parts[0] else 0
            end       = int(parts[1]) if parts[1] else file_size - 1
            status_code = 206
        except Exception:
            pass

    length = end - start + 1
    ascii_name = file_name.encode("ascii", "ignore").decode()
    enc_name   = file_name.encode("utf-8").decode("latin-1", errors="replace")

    headers = {
        "Content-Type":        mime_type,
        "Content-Length":      str(length),
        "Content-Range":       f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges":       "bytes",
        "Content-Disposition": f'inline; filename="{ascii_name}"',
        "Access-Control-Allow-Origin": "*",
    }

    async def generate():
        async for chunk in stream_file(client, file_id, file_size, start, length):
            yield chunk

    return StreamingResponse(generate(), status_code=status_code, headers=headers)


# ── /file/:token (download) ───────────────────────────────────
@app.get("/file/{seq}")
async def download_endpoint(seq: str, request: Request):
    token    = request.query_params.get("token", "")
    hash_val = request.query_params.get("hash", "")

    if not verify_hash(token, hash_val):
        raise HTTPException(status_code=403, detail="Forbidden")

    meta = decode_token(token)
    if not meta or not meta.get("fileId"):
        raise HTTPException(status_code=400, detail="Bad token")

    file_id   = meta["fileId"]
    file_size = meta.get("fileSize", 0)
    mime_type = meta.get("mimeType", "application/octet-stream")
    file_name = meta.get("fileName", "file")
    ascii_name = file_name.encode("ascii", "ignore").decode()

    client = await get_client()

    headers = {
        "Content-Type":        mime_type,
        "Content-Length":      str(file_size),
        "Content-Disposition": f'attachment; filename="{ascii_name}"',
        "Accept-Ranges":       "bytes",
        "Access-Control-Allow-Origin": "*",
    }

    async def generate():
        async for chunk in stream_file(client, file_id, file_size, 0, -1):
            yield chunk

    return StreamingResponse(generate(), status_code=200, headers=headers)


# ── Health check ──────────────────────────────────────────────
@app.get("/")
async def health():
    return {"status": "ok", "service": "StreambotV2 Stream Server"}


# ── Startup / shutdown ────────────────────────────────────────
@app.on_event("startup")
async def startup():
    await get_client()

@app.on_event("shutdown")
async def shutdown():
    global pyro
    if pyro and pyro.is_connected:
        await pyro.stop()


if __name__ == "__main__":
    uvicorn.run(
        "stream_server:app",
        host="0.0.0.0",
        port=8080,
        log_level="info",
)
      
