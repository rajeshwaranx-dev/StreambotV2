// ============================================================
//  StreambotV2 — Cloudflare Worker
//  Handles: /watch/:token, /stream/:token, /file/:token
//  Env vars: BOT_TOKEN, SECRET_KEY
// ============================================================

const THEMES = {
  dark_gold: {
    bg: "#0d0d0d",
    surface: "#1a1a1a",
    border: "#2a2a2a",
    primary: "#f0c040",
    accent: "#d4a017",
    text: "#f5f5f5",
    muted: "#888",
    glow: "rgba(240,192,64,0.18)",
  },
  midnight_blue: {
    bg: "#070b14",
    surface: "#0f1829",
    border: "#1e2d45",
    primary: "#4fa3e8",
    accent: "#2979c2",
    text: "#e8f0fa",
    muted: "#6b8aab",
    glow: "rgba(79,163,232,0.18)",
  },
  deep_purple: {
    bg: "#0b0812",
    surface: "#160f24",
    border: "#2a1d3e",
    primary: "#b06de8",
    accent: "#8a3fc8",
    text: "#f0eaff",
    muted: "#8070a0",
    glow: "rgba(176,109,232,0.18)",
  },
  emerald: {
    bg: "#080f0d",
    surface: "#0e1c18",
    border: "#163027",
    primary: "#3dd68c",
    accent: "#1fab68",
    text: "#e6fff5",
    muted: "#5a9e7e",
    glow: "rgba(61,214,140,0.18)",
  },
  crimson: {
    bg: "#0f0808",
    surface: "#1c0e0e",
    border: "#2e1414",
    primary: "#e84040",
    accent: "#b82020",
    text: "#fff0f0",
    muted: "#a06060",
    glow: "rgba(232,64,64,0.18)",
  },
};

// ─── Routing ────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/watch/")) {
      return handleWatch(request, env, url);
    }
    if (path.startsWith("/stream/")) {
      return handleStream(request, env, url);
    }
    if (path.startsWith("/file/")) {
      return handleFile(request, env, url);
    }

    return new Response("StreambotV2", { status: 200 });
  },
};

// ─── HMAC-SHA256 hash verification ──────────────────────────
async function verifyHash(token, hash, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sig = hexToBytes(hash);
  const data = new TextEncoder().encode(token);
  return crypto.subtle.verify("HMAC", key, sig, data);
}

async function makeHash(token, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = new TextEncoder().encode(token);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return bytesToHex(new Uint8Array(sig));
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Fetch file info from Telegram ──────────────────────────
async function getTelegramFileInfo(fileId, botToken) {
  const r = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  if (!r.ok) return null;
  const j = await r.json();
  return j.ok ? j.result : null;
}

// ─── Parse token → { seq, fileId, fileName, mimeType } ──────
// Token format stored by bot: "000001_<base64url(metadata_json)>"
// hash query param carries HMAC of the seq part
function decodeToken(token) {
  try {
    const [seq, b64] = token.split("_");
    if (!seq || !b64) return null;
    const json = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    return { seq, ...JSON.parse(json) };
  } catch {
    return null;
  }
}

// ─── /watch/:token?hash=xxx  — HTML watch page ──────────────
async function handleWatch(request, env, url) {
  const token = url.pathname.slice(7); // strip /watch/
  const hash = url.searchParams.get("hash") || "";
  const themeName = url.searchParams.get("theme") || "dark_gold";
  const theme = THEMES[themeName] || THEMES.dark_gold;

  // Verify hash
  const valid = await verifyHash(token, hash, env.SECRET_KEY);
  if (!valid) return errorPage("Invalid or expired link.", theme);

  const meta = decodeToken(token);
  if (!meta) return errorPage("Corrupted token.", theme);

  const streamUrl = `${url.origin}/stream/${token}?hash=${hash}`;
  const downloadUrl = `${url.origin}/file/${token}?hash=${hash}`;
  const isVideo = (meta.mimeType || "").startsWith("video");
  const isAudio = (meta.mimeType || "").startsWith("audio");
  const isMedia = isVideo || isAudio;

  const html = buildWatchPage({
    meta,
    streamUrl,
    downloadUrl,
    theme,
    isVideo,
    isAudio,
    isMedia,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}

// ─── /stream/:token?hash=xxx  — streaming with range support ─
async function handleStream(request, env, url) {
  const token = url.pathname.slice(8);
  const hash = url.searchParams.get("hash") || "";

  const valid = await verifyHash(token, hash, env.SECRET_KEY);
  if (!valid) return new Response("Forbidden", { status: 403 });

  const meta = decodeToken(token);
  if (!meta || !meta.fileId)
    return new Response("Bad token", { status: 400 });

  const fileInfo = await getTelegramFileInfo(meta.fileId, env.BOT_TOKEN);
  if (!fileInfo) return new Response("File not found", { status: 404 });

  const tgUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileInfo.file_path}`;
  const rangeHeader = request.headers.get("Range");

  const upstream = await fetch(tgUrl, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });

  const fileName = meta.fileName || "file";
  const mimeType = meta.mimeType || "application/octet-stream";

  // RFC 5987 Unicode filename
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(fileName);
  const contentDisposition =
    `inline; filename="${asciiName}"; ` +
    `filename*=UTF-8''${encodedName}`;

  const headers = new Headers(upstream.headers);
  headers.set("Content-Type", mimeType);
  headers.set("Content-Disposition", contentDisposition);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

// ─── /file/:token?hash=xxx  — force download ────────────────
async function handleFile(request, env, url) {
  const token = url.pathname.slice(6);
  const hash = url.searchParams.get("hash") || "";

  const valid = await verifyHash(token, hash, env.SECRET_KEY);
  if (!valid) return new Response("Forbidden", { status: 403 });

  const meta = decodeToken(token);
  if (!meta || !meta.fileId)
    return new Response("Bad token", { status: 400 });

  const fileInfo = await getTelegramFileInfo(meta.fileId, env.BOT_TOKEN);
  if (!fileInfo) return new Response("File not found", { status: 404 });

  const tgUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileInfo.file_path}`;
  const upstream = await fetch(tgUrl);

  const fileName = meta.fileName || "file";
  const mimeType = meta.mimeType || "application/octet-stream";
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(fileName);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition":
        `attachment; filename="${asciiName}"; ` +
        `filename*=UTF-8''${encodedName}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── Watch page HTML ─────────────────────────────────────────
function buildWatchPage({ meta, streamUrl, downloadUrl, theme, isVideo, isAudio, isMedia }) {
  const { bg, surface, border, primary, accent, text, muted, glow } = theme;
  const title = meta.fileName || "Media File";
  const fileSize = meta.fileSize
    ? formatBytes(meta.fileSize)
    : "Unknown size";
  const caption = meta.caption || "";

  const playerBlock = isVideo
    ? `<video id="player" controls preload="metadata" playsinline>
        <source src="${streamUrl}" type="${meta.mimeType || "video/mp4"}">
        Your browser does not support video playback.
       </video>`
    : isAudio
    ? `<audio id="player" controls preload="metadata">
        <source src="${streamUrl}" type="${meta.mimeType || "audio/mpeg"}">
        Your browser does not support audio playback.
       </audio>`
    : `<div class="no-player">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${primary}" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>Preview not available for this file type.</p>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escHtml(title)}</title>
<meta property="og:title" content="${escHtml(title)}"/>
<meta property="og:type" content="${isVideo ? "video.other" : "website"}"/>
${isVideo ? `<meta property="og:video" content="${streamUrl}"/>` : ""}
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: ${bg};
    --surface: ${surface};
    --border: ${border};
    --primary: ${primary};
    --accent: ${accent};
    --text: ${text};
    --muted: ${muted};
    --glow: ${glow};
    --radius: 12px;
    --font: 'Inter', system-ui, sans-serif;
  }

  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    min-height: 100dvh;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Layout ── */
  .wrapper {
    max-width: 820px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-mark {
    width: 36px; height: 36px;
    background: var(--primary);
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .logo-mark svg { display: block; }
  .brand {
    font-size: 18px;
    font-weight: 600;
    color: var(--primary);
    letter-spacing: -.01em;
  }

  /* ── Player card ── */
  .player-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: 0 0 40px var(--glow);
  }

  #player {
    width: 100%;
    display: block;
    background: #000;
    max-height: 480px;
    outline: none;
  }

  audio#player {
    width: 100%;
    max-height: none;
    padding: 20px;
    background: var(--surface);
  }

  .no-player {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 48px 24px;
    color: var(--muted);
    font-size: 15px;
  }

  /* ── Info card ── */
  .info-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .file-title {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.35;
    word-break: break-word;
    color: var(--text);
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: 13px;
    color: var(--muted);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .meta-item svg { flex-shrink: 0; }

  .caption-block {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }

  /* ── Buttons ── */
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 22px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: filter .15s, transform .1s;
    white-space: nowrap;
  }
  .btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .btn:active { transform: translateY(0); }

  .btn-primary {
    background: var(--primary);
    color: #000;
  }
  .btn-outline {
    background: transparent;
    color: var(--primary);
    border: 1px solid var(--primary);
  }

  /* ── Progress bar (video only) ── */
  .progress-wrap {
    padding: 0 22px 18px;
  }
  .progress-track {
    height: 3px;
    background: var(--border);
    border-radius: 99px;
    overflow: hidden;
    cursor: pointer;
  }
  .progress-fill {
    height: 100%;
    background: var(--primary);
    width: 0%;
    transition: width .2s linear;
    border-radius: 99px;
  }
  .time-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--muted);
    margin-top: 6px;
  }

  /* ── Footer ── */
  .footer {
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    padding-top: 8px;
  }
  .footer a { color: var(--primary); text-decoration: none; }

  /* ── Error / loading states ── */
  .toast {
    position: fixed;
    bottom: 24px; left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    opacity: 0;
    pointer-events: none;
    transition: opacity .2s;
    z-index: 99;
    white-space: nowrap;
  }
  .toast.show { opacity: 1; }

  @media (max-width: 480px) {
    .wrapper { padding: 16px 12px 40px; }
    .file-title { font-size: 15px; }
    .btn { flex: 1; justify-content: center; }
  }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <header class="header">
    <div class="logo-mark">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    </div>
    <span class="brand">StreamBot</span>
  </header>

  <!-- Player -->
  <div class="player-card">
    ${playerBlock}
    ${isVideo ? `
    <div class="progress-wrap">
      <div class="progress-track" id="progressTrack">
        <div class="progress-fill" id="progressFill"></div>
      </div>
      <div class="time-row">
        <span id="timeElapsed">0:00</span>
        <span id="timeDuration">0:00</span>
      </div>
    </div>` : ""}
  </div>

  <!-- Info -->
  <div class="info-card">
    <div class="file-title">${escHtml(title)}</div>
    <div class="meta-row">
      <div class="meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
        ${escHtml(fileSize)}
      </div>
      ${meta.mimeType ? `
      <div class="meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        ${escHtml(meta.mimeType)}
      </div>` : ""}
    </div>
    ${caption ? `<div class="caption-block">${escHtml(caption)}</div>` : ""}
  </div>

  <!-- Actions -->
  <div class="actions">
    ${isMedia ? `<a class="btn btn-primary" href="${streamUrl}" target="_blank">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      ${isVideo ? "Watch" : "Play"}
    </a>` : ""}
    <a class="btn btn-${isMedia ? "outline" : "primary"}" href="${downloadUrl}" id="dlBtn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download
    </a>
    <button class="btn btn-outline" id="copyBtn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      Copy Link
    </button>
  </div>

  <footer class="footer">Powered by StreamBot &amp; Cloudflare Workers</footer>
</div>

<div class="toast" id="toast"></div>

<script>
(function() {
  // Toast helper
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  // Copy link
  document.getElementById('copyBtn').addEventListener('click', function() {
    navigator.clipboard.writeText(location.href).then(
      () => showToast('Link copied!'),
      () => showToast('Could not copy link')
    );
  });

  // Video progress
  const vid = document.getElementById('player');
  const fill = document.getElementById('progressFill');
  const elapsed = document.getElementById('timeElapsed');
  const duration = document.getElementById('timeDuration');
  const track = document.getElementById('progressTrack');

  function fmtTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  if (vid && vid.tagName === 'VIDEO') {
    vid.addEventListener('timeupdate', function() {
      if (!vid.duration) return;
      const pct = (vid.currentTime / vid.duration) * 100;
      if (fill) fill.style.width = pct + '%';
      if (elapsed) elapsed.textContent = fmtTime(vid.currentTime);
    });
    vid.addEventListener('loadedmetadata', function() {
      if (duration) duration.textContent = fmtTime(vid.duration);
    });
    if (track) {
      track.addEventListener('click', function(e) {
        const rect = track.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        vid.currentTime = pct * vid.duration;
      });
    }
  }
})();
</script>
</body>
</html>`;
}

// ─── Error page ──────────────────────────────────────────────
function errorPage(msg, theme = THEMES.dark_gold) {
  const { bg, surface, border, primary, text, muted } = theme;
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Error</title>
    <style>
      body{background:${bg};color:${text};font-family:system-ui,sans-serif;
           display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
      .card{background:${surface};border:1px solid ${border};border-radius:12px;
            padding:36px 32px;max-width:360px;text-align:center}
      h2{color:${primary};font-size:20px;margin-bottom:10px}
      p{color:${muted};font-size:14px;line-height:1.6}
    </style></head>
    <body><div class="card"><h2>Unable to load file</h2><p>${escHtml(msg)}</p></div></body>
    </html>`,
    { status: 403, headers: { "Content-Type": "text/html;charset=UTF-8" } }
  );
}

// ─── Helpers ─────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024,
    sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
