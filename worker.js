// ============================================================
//  StreambotV2 — Premium Cloudflare Worker
//  Routes: /watch/:seq  /stream/:seq  /file/:seq
//  Env: BOT_TOKEN, SECRET_KEY, SHORTENER_URL (optional),
//       BOT_NAME, BOT_LOGO, THEME, WORKER_URL
// ============================================================

const THEMES = {
  dark_gold:     { bg:"#0a0a0a", card:"#111", border:"#222", primary:"#f0c040", accent:"#d4a017", text:"#f0f0f0", muted:"#666", glow:"rgba(240,192,64,0.15)", badge:"#1a1600" },
  midnight_blue: { bg:"#06090f", card:"#0d1420", border:"#1a2640", primary:"#5bb8ff", accent:"#2979c2", text:"#e8f0fa", muted:"#4a6a8a", glow:"rgba(91,184,255,0.15)", badge:"#001020" },
  deep_purple:   { bg:"#080610", card:"#110d1e", border:"#221840", primary:"#c084fc", accent:"#9333ea", text:"#f0eaff", muted:"#6040a0", glow:"rgba(192,132,252,0.15)", badge:"#100820" },
  emerald:       { bg:"#060c0a", card:"#0c1814", border:"#142a20", primary:"#34d399", accent:"#059669", text:"#e6fff5", muted:"#2a6050", glow:"rgba(52,211,153,0.15)", badge:"#001a10" },
  crimson:       { bg:"#0c0606", card:"#1a0c0c", border:"#2e1414", primary:"#f87171", accent:"#dc2626", text:"#fff0f0", muted:"#804040", glow:"rgba(248,113,113,0.15)", badge:"#1a0000" },
  ocean:         { bg:"#040c14", card:"#081826", border:"#0e2840", primary:"#22d3ee", accent:"#0891b2", text:"#e0f8ff", muted:"#2a5a70", glow:"rgba(34,211,238,0.15)", badge:"#001828" },
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const p = url.pathname;
      if (p === "/" || p === "") return new Response("StreambotV2", { status:200 });
      if (p.startsWith("/watch/"))  return handleWatch(request, env, url);
      if (p.startsWith("/stream/")) return handleStream(request, env, url);
      if (p.startsWith("/file/"))   return handleFile(request, env, url);
      return new Response("Not found", { status:404 });
    } catch(e) {
      return new Response("Error: " + e.message, { status:500 });
    }
  }
};

// ── HMAC ─────────────────────────────────────────────────────
async function makeHmac(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function verifyHash(token, hash, secret) {
  try { return (await makeHmac(token, secret)) === hash; } catch { return false; }
}

// ── Token decode ─────────────────────────────────────────────
function decodeToken(token) {
  try {
    const i = token.indexOf("_");
    if (i === -1) return null;
    const b64 = token.slice(i+1);
    const pad = b64 + "==".slice(0,(4-b64.length%4)%4);
    return { seq: token.slice(0,i), ...JSON.parse(atob(pad.replace(/-/g,"+").replace(/_/g,"/"))) };
  } catch { return null; }
}

// ── Telegram getFile ─────────────────────────────────────────
async function getTgFile(fileId, botToken) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const j = await r.json();
    return j.ok ? j.result : null;
  } catch { return null; }
}

// ── /watch/ ──────────────────────────────────────────────────
async function handleWatch(request, env, url) {
  const seq      = url.pathname.slice(7);
  const hash     = url.searchParams.get("hash") || "";
  const token    = url.searchParams.get("token") || seq;
  const themeName= url.searchParams.get("theme") || env.THEME || "dark_gold";
  const theme    = THEMES[themeName] || THEMES.dark_gold;

  if (!await verifyHash(token, hash, env.SECRET_KEY))
    return errorPage("Invalid or expired link.", theme);

  const meta = decodeToken(token);
  if (!meta) return errorPage("Corrupted token.", theme);

  const origin      = url.origin;
  const streamUrl   = `${origin}/stream/${seq}?hash=${hash}&token=${token}`;
  const downloadUrl = `${origin}/file/${seq}?hash=${hash}&token=${token}`;
  const fastUrl     = env.SHORTENER_URL
    ? `${env.SHORTENER_URL}${encodeURIComponent(downloadUrl)}`
    : downloadUrl;

  const botName  = env.BOT_NAME  || "StreamBot";
  const botLogo  = env.BOT_LOGO  || "";
  const botLink  = env.BOT_LINK  || "";

  const isVideo = (meta.mimeType||"").startsWith("video");
  const isAudio = (meta.mimeType||"").startsWith("audio");

  return new Response(
    watchPage({ meta, streamUrl, downloadUrl, fastUrl, theme, isVideo, isAudio, botName, botLogo, botLink }),
    { headers:{ "Content-Type":"text/html;charset=UTF-8" } }
  );
}

// ── /stream/ ─────────────────────────────────────────────────
async function handleStream(request, env, url) {
  const hash  = url.searchParams.get("hash") || "";
  const token = url.searchParams.get("token") || "";
  if (!await verifyHash(token, hash, env.SECRET_KEY))
    return new Response("Forbidden", { status:403 });
  const meta = decodeToken(token);
  if (!meta?.fileId) return new Response("Bad token", { status:400 });
  const info = await getTgFile(meta.fileId, env.BOT_TOKEN);
  if (!info) return new Response("File not found on Telegram", { status:404 });
  const tgUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.file_path}`;
  const range = request.headers.get("Range");
  const up    = await fetch(tgUrl, { headers: range ? { Range:range } : {} });
  const fname = meta.fileName || "file";
  const ascii = fname.replace(/[^\x20-\x7e]/g,"_");
  const enc   = encodeURIComponent(fname);
  const h     = new Headers(up.headers);
  h.set("Content-Type", meta.mimeType || "application/octet-stream");
  h.set("Content-Disposition", `inline; filename="${ascii}"; filename*=UTF-8''${enc}`);
  h.set("Accept-Ranges","bytes");
  h.set("Access-Control-Allow-Origin","*");
  return new Response(up.body, { status:up.status, headers:h });
}

// ── /file/ ───────────────────────────────────────────────────
async function handleFile(request, env, url) {
  const hash  = url.searchParams.get("hash") || "";
  const token = url.searchParams.get("token") || "";
  if (!await verifyHash(token, hash, env.SECRET_KEY))
    return new Response("Forbidden", { status:403 });
  const meta = decodeToken(token);
  if (!meta?.fileId) return new Response("Bad token", { status:400 });
  const info = await getTgFile(meta.fileId, env.BOT_TOKEN);
  if (!info) return new Response("File not found on Telegram", { status:404 });
  const tgUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.file_path}`;
  const up    = await fetch(tgUrl);
  const fname = meta.fileName || "file";
  const ascii = fname.replace(/[^\x20-\x7e]/g,"_");
  const enc   = encodeURIComponent(fname);
  return new Response(up.body, {
    status: up.status,
    headers: {
      "Content-Type": meta.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`,
      "Access-Control-Allow-Origin": "*",
    }
  });
}

// ── Watch page HTML ───────────────────────────────────────────
function watchPage({ meta, streamUrl, downloadUrl, fastUrl, theme, isVideo, isAudio, botName, botLogo, botLink }) {
  const { bg, card, border, primary, accent, text, muted, glow, badge } = theme;
  const title   = esc(meta.fileName || "Media File");
  const size    = fmtBytes(meta.fileSize);
  const caption = esc(meta.caption || "");
  const mime    = esc(meta.mimeType || "");
  const isMedia = isVideo || isAudio;

  const vlcUrl  = `vlc://${streamUrl}`;
  const mxUrl   = `intent:${streamUrl}#Intent;package=com.mxtech.videoplayer.ad;end`;

  const player = isVideo
    ? `<div class="player-wrap">
        <video id="vid" preload="metadata" playsinline>
          <source src="${streamUrl}" type="${mime}">
        </video>
        <div class="play-overlay" id="overlay" onclick="togglePlay()">
          <div class="play-btn"><svg width="28" height="28" viewBox="0 0 24 24" fill="${bg}"><polygon points="5,3 19,12 5,21"/></svg></div>
        </div>
        <div class="vid-controls">
          <div class="progress-bar" id="pbar" onclick="seek(event)">
            <div class="progress-fill" id="pfill"></div>
            <div class="progress-thumb" id="pthumb"></div>
          </div>
          <div class="ctrl-row">
            <div class="ctrl-left">
              <button class="ctrl-btn" onclick="togglePlay()" id="playBtn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              </button>
              <span class="time-display"><span id="cur">0:00</span> / <span id="dur">--:--</span></span>
            </div>
            <div class="ctrl-right">
              <button class="ctrl-btn" onclick="toggleMute()" id="muteBtn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </button>
              <button class="ctrl-btn" onclick="toggleFS()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>`
    : isAudio
    ? `<div class="audio-wrap">
        <div class="audio-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${primary}" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <audio id="vid" preload="metadata" controls style="width:100%;margin-top:16px">
          <source src="${streamUrl}" type="${mime}">
        </audio>
      </div>`
    : `<div class="no-media">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${primary}" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>No preview available</p>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>${title}</title>
<meta name="theme-color" content="${bg}"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:${bg};--card:${card};--border:${border};
  --primary:${primary};--accent:${accent};
  --text:${text};--muted:${muted};--glow:${glow};--badge:${badge};
}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100dvh;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer}

/* ── Layout ── */
.page{max-width:720px;margin:0 auto;padding:12px 12px 48px}

/* ── Header ── */
.header{display:flex;align-items:center;justify-content:space-between;padding:4px 0 16px}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:38px;height:38px;border-radius:10px;overflow:hidden;background:var(--primary);display:grid;place-items:center;flex-shrink:0}
.logo img{width:100%;height:100%;object-fit:cover}
.logo-icon{font-size:20px;line-height:1}
.bot-name{font-size:17px;font-weight:700;color:var(--primary);letter-spacing:-.02em}
.tg-btn{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;background:rgba(91,184,255,0.12);border:1px solid rgba(91,184,255,0.25);color:#5bb8ff;font-size:13px;font-weight:500}
.tg-btn svg{flex-shrink:0}

/* ── Player card ── */
.player-card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:0 0 60px var(--glow),0 2px 20px rgba(0,0,0,.4);margin-bottom:14px}

/* ── Video player ── */
.player-wrap{position:relative;background:#000;aspect-ratio:16/9}
.player-wrap video{width:100%;height:100%;display:block;object-fit:contain}
.play-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:opacity .2s}
.play-overlay.hidden{opacity:0;pointer-events:none}
.play-btn{width:64px;height:64px;border-radius:50%;background:var(--primary);display:grid;place-items:center;box-shadow:0 0 30px var(--glow);transition:transform .15s}
.play-btn:hover{transform:scale(1.08)}
.vid-controls{background:linear-gradient(transparent,rgba(0,0,0,.85));padding:8px 14px 12px;position:absolute;bottom:0;left:0;right:0}
.progress-bar{height:3px;background:rgba(255,255,255,.2);border-radius:99px;cursor:pointer;position:relative;margin-bottom:10px}
.progress-bar:hover{height:5px;margin-bottom:8px}
.progress-fill{height:100%;background:var(--primary);border-radius:99px;width:0%;transition:width .1s linear}
.progress-thumb{width:12px;height:12px;background:var(--primary);border-radius:50%;position:absolute;top:50%;transform:translate(-50%,-50%);left:0%;transition:left .1s linear;display:none}
.progress-bar:hover .progress-thumb{display:block}
.ctrl-row{display:flex;align-items:center;justify-content:space-between}
.ctrl-left,.ctrl-right{display:flex;align-items:center;gap:10px}
.ctrl-btn{background:none;border:none;color:rgba(255,255,255,.85);padding:4px;border-radius:6px;display:grid;place-items:center;transition:color .15s}
.ctrl-btn:hover{color:#fff}
.time-display{font-size:12px;color:rgba(255,255,255,.7);font-variant-numeric:tabular-nums}

/* ── Audio ── */
.audio-wrap{padding:32px 24px;display:flex;flex-direction:column;align-items:center;gap:8px}
.audio-icon{width:88px;height:88px;border-radius:50%;background:var(--badge);border:1px solid var(--border);display:grid;place-items:center}

/* ── No media ── */
.no-media{padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;color:var(--muted);font-size:14px}

/* ── File info ── */
.info-section{padding:16px 18px;border-top:1px solid var(--border)}
.file-title{font-size:15px;font-weight:600;line-height:1.4;word-break:break-word;margin-bottom:10px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:500;background:var(--badge);border:1px solid var(--border);color:var(--primary)}
.caption{font-size:13px;line-height:1.6;color:var(--muted);white-space:pre-wrap;word-break:break-word;padding-top:10px;border-top:1px solid var(--border)}

/* ── Network bar ── */
.network-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
.net-status{display:flex;align-items:center;gap:6px}
.net-dot{width:8px;height:8px;border-radius:50%;background:#f87171;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.net-dot.good{background:#34d399;animation:none}
.net-bars{display:flex;align-items:flex-end;gap:2px}
.bar{width:4px;border-radius:2px;background:var(--border)}
.bar.active{background:var(--primary)}

/* ── Action sections ── */
.section{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:10px;box-shadow:0 2px 12px rgba(0,0,0,.3)}
.section-title{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:12px 18px 8px}
.action-btn{display:flex;align-items:center;gap:12px;padding:14px 18px;border:none;background:none;color:var(--text);width:100%;text-align:left;font-size:14px;font-weight:500;transition:background .15s;border-top:1px solid var(--border)}
.action-btn:first-of-type{border-top:none}
.action-btn:hover{background:rgba(255,255,255,.04)}
.action-btn:active{background:rgba(255,255,255,.08)}
.action-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;font-size:18px}
.action-label{flex:1}
.action-label span{display:block;font-size:12px;color:var(--muted);font-weight:400;margin-top:1px}
.action-arrow{color:var(--muted)}
.icon-dl{background:rgba(52,211,153,.12)}
.icon-fast{background:rgba(251,191,36,.12)}
.icon-tg{background:rgba(91,184,255,.12)}
.icon-copy{background:rgba(192,132,252,.12)}

/* ── Player grid ── */
.player-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)}
.player-tile{background:var(--card);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:18px 12px;border:none;color:var(--text);font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.player-tile:hover{background:rgba(255,255,255,.05)}
.player-emoji{font-size:28px}
.more-players{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;background:var(--card);border:none;color:var(--muted);font-size:13px;font-weight:500;width:100%;border-top:1px solid var(--border);cursor:pointer;transition:background .15s}
.more-players:hover{background:rgba(255,255,255,.04)}

/* ── Footer ── */
.footer{text-align:center;font-size:12px;color:var(--muted);padding-top:16px;line-height:1.8}
.footer a{color:var(--primary)}
.dmca{font-size:11px;color:var(--muted);opacity:.6;padding-top:4px}

/* ── Toast ── */
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 20px;border-radius:10px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:99;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.4)}
.toast.show{opacity:1}

@media(max-width:480px){
  .page{padding:8px 8px 40px}
  .player-grid{grid-template-columns:1fr 1fr}
}
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="brand">
      <div class="logo">
        ${botLogo ? `<img src="${esc(botLogo)}" alt="${esc(botName)}"/>` : `<span class="logo-icon">▶</span>`}
      </div>
      <div class="bot-name">${esc(botName)}</div>
    </div>
    ${botLink ? `<a href="${esc(botLink)}" class="tg-btn" target="_blank">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="#5bb8ff"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>
      Bot
    </a>` : ""}
  </div>

  <!-- Player card -->
  <div class="player-card">
    ${player}
    <div class="info-section">
      <div class="file-title">${title}</div>
      <div class="badges">
        ${size ? `<span class="badge">💾 ${size}</span>` : ""}
        ${mime ? `<span class="badge">${mimeIcon(meta.mimeType)} ${mimeLabel(meta.mimeType)}</span>` : ""}
        ${isVideo ? `<span class="badge">📺 HD</span>` : ""}
      </div>
      ${caption ? `<div class="caption">${caption}</div>` : ""}
    </div>
    <div class="network-bar">
      <div class="net-status">
        <div class="net-dot" id="netDot"></div>
        <span id="netLabel">Checking speed…</span>
      </div>
      <div class="net-bars">
        <div class="bar" id="b1" style="height:6px"></div>
        <div class="bar" id="b2" style="height:10px"></div>
        <div class="bar" id="b3" style="height:14px"></div>
        <div class="bar" id="b4" style="height:18px"></div>
      </div>
    </div>
  </div>

  <!-- Download section -->
  <div class="section">
    <div class="section-title">Download</div>
    <a href="${downloadUrl}" class="action-btn">
      <div class="action-icon icon-dl">⬇️</div>
      <div class="action-label">Normal Download<span>Direct from Telegram</span></div>
      <svg class="action-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
    </a>
    <a href="${fastUrl}" class="action-btn" target="_blank">
      <div class="action-icon icon-fast">⚡</div>
      <div class="action-label">Fast Download<span>Via shortener</span></div>
      <svg class="action-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
    </a>
    <button class="action-btn" onclick="copyLink()">
      <div class="action-icon icon-copy">🔗</div>
      <div class="action-label">Copy Link<span>Share this page</span></div>
      <svg class="action-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
    </button>
  </div>

  ${isMedia ? `
  <!-- Stream on -->
  <div class="section">
    <div class="section-title">Stream On</div>
    <div class="player-grid">
      <button class="player-tile" onclick="openVlc()">
        <span class="player-emoji">🔶</span>
        VLC
      </button>
      <button class="player-tile" onclick="openMx()">
        <span class="player-emoji">🔵</span>
        MX Player
      </button>
    </div>
    <button class="more-players" onclick="showMorePlayers()">
      ⋯ More Players
    </button>
  </div>` : ""}

  <!-- Footer -->
  <div class="footer">
    Powered by <a href="#">${esc(botName)}</a> &amp; Cloudflare Workers
    <div class="dmca">All files are user-uploaded. We are not responsible for the content.</div>
  </div>

</div>

<div class="toast" id="toast"></div>

<script>
const STREAM = ${JSON.stringify(streamUrl)};
const VLC_URL = "vlc://" + STREAM;
const MX_URL  = "intent:" + STREAM + "#Intent;package=com.mxtech.videoplayer.ad;end";

// ── Toast ──
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ── Copy link ──
function copyLink() {
  navigator.clipboard.writeText(location.href)
    .then(() => toast("✓ Link copied!"))
    .catch(() => toast("Could not copy"));
}

// ── VLC / MX ──
function openVlc() { window.location.href = VLC_URL; toast("Opening VLC…"); }
function openMx()  { window.location.href = MX_URL;  toast("Opening MX Player…"); }
function showMorePlayers() {
  const urls = [
    ["nPlayer", "nplayer-" + STREAM],
    ["Infuse",  "infuse://x-callback-url/play?url=" + encodeURIComponent(STREAM)],
    ["Vimu",    "vimu://" + STREAM],
  ];
  const msg = urls.map(([n,u]) => n).join(", ");
  toast("Try: " + msg);
}

// ── Video player ──
const vid = document.getElementById("vid");
const overlay = document.getElementById("overlay");
const pfill   = document.getElementById("pfill");
const pthumb  = document.getElementById("pthumb");
const curEl   = document.getElementById("cur");
const durEl   = document.getElementById("dur");
const playBtn = document.getElementById("playBtn");

function fmt(s) {
  if (!isFinite(s)) return "--:--";
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return m + ":" + String(sec).padStart(2,"0");
}

if (vid && vid.tagName === "VIDEO") {
  vid.addEventListener("loadedmetadata", () => { if(durEl) durEl.textContent = fmt(vid.duration); });
  vid.addEventListener("timeupdate", () => {
    if (!vid.duration) return;
    const pct = (vid.currentTime / vid.duration) * 100;
    if (pfill)  pfill.style.width  = pct + "%";
    if (pthumb) pthumb.style.left  = pct + "%";
    if (curEl)  curEl.textContent  = fmt(vid.currentTime);
  });
  vid.addEventListener("play",  () => {
    if (overlay) overlay.classList.add("hidden");
    if (playBtn) playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  });
  vid.addEventListener("pause", () => {
    if (overlay) overlay.classList.remove("hidden");
    if (playBtn) playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
  });
}

function togglePlay() {
  if (!vid) return;
  vid.paused ? vid.play() : vid.pause();
}

function toggleMute() {
  if (!vid) return;
  vid.muted = !vid.muted;
  toast(vid.muted ? "🔇 Muted" : "🔊 Unmuted");
}

function toggleFS() {
  const el = document.querySelector(".player-wrap") || vid;
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.();
}

function seek(e) {
  if (!vid?.duration) return;
  const bar = document.getElementById("pbar");
  const rect = bar.getBoundingClientRect();
  vid.currentTime = ((e.clientX - rect.left) / rect.width) * vid.duration;
}

// ── Network speed ──
(async function checkSpeed() {
  const start = Date.now();
  try {
    const r = await fetch(location.href, { method:"HEAD", cache:"no-store" });
    const ms = Date.now() - start;
    const dot   = document.getElementById("netDot");
    const label = document.getElementById("netLabel");
    const bars  = [document.getElementById("b1"),document.getElementById("b2"),
                   document.getElementById("b3"),document.getElementById("b4")];
    let level, text;
    if      (ms < 200)  { level=4; text="Excellent"; }
    else if (ms < 400)  { level=3; text="Good"; }
    else if (ms < 800)  { level=2; text="Fair"; }
    else                { level=1; text="Poor"; }
    if (dot)   { dot.className = "net-dot" + (level >= 3 ? " good" : ""); }
    if (label) { label.textContent = text + " connection"; }
    bars.forEach((b,i) => { if(b) b.className = "bar" + (i < level ? " active" : ""); });
  } catch {}
})();
</script>
</body>
</html>`;
}

// ── Error page ────────────────────────────────────────────────
function errorPage(msg, theme) {
  const { bg, card, border, primary, muted } = theme;
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Error</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:${bg};font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .c{background:${card};border:1px solid ${border};border-radius:16px;padding:40px 32px;max-width:340px;text-align:center}
    h2{color:${primary};font-size:20px;margin-bottom:10px}
    p{color:${muted};font-size:14px;line-height:1.6}
    </style></head><body>
    <div class="c"><h2>⚠️ Error</h2><p>${esc(msg)}</p></div>
    </body></html>`,
    { status:403, headers:{ "Content-Type":"text/html;charset=UTF-8" } }
  );
}

// ── Helpers ───────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return "";
  const u=["B","KB","MB","GB"]; let i=0;
  while(b>=1024&&i<3){b/=1024;i++;}
  return b.toFixed(1)+" "+u[i];
}
function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function mimeIcon(m) {
  if (!m) return "📄";
  if (m.startsWith("video")) return "🎬";
  if (m.startsWith("audio")) return "🎵";
  if (m.startsWith("image")) return "🖼";
  return "📄";
}
function mimeLabel(m) {
  if (!m) return "File";
  return m.split("/")[1]?.toUpperCase() || m;
        }
