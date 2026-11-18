export function renderHome(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vidmate YT Downloader</title>
<style>
  :root { --bg:#0b0f17; --card:#141b26; --line:#243040; --fg:#e7eef8; --mut:#8ba0b8; --acc:#ff4d4d; --acc2:#4dabff; --grn:#2fbf71; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  .wrap { max-width:1080px; margin:0 auto; padding:28px 18px 60px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--mut); font-size:13px; margin-bottom:20px; }
  form { display:flex; gap:8px; flex-wrap:wrap; }
  input[type=text] { flex:1; min-width:240px; padding:12px 14px; border-radius:10px; border:1px solid var(--line); background:#0e141d; color:var(--fg); font-size:15px; }
  button { padding:12px 18px; border:0; border-radius:10px; background:var(--acc); color:#fff; font-weight:600; font-size:15px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .msg { margin-top:14px; font-size:14px; }
  .err { color:#ff8080; }
  .vid { margin-top:22px; display:none; }
  .vid.show { display:block; }
  .meta { display:flex; gap:14px; align-items:flex-start; }
  .meta img { width:160px; border-radius:8px; background:#000; }
  .meta h2 { font-size:16px; margin:0 0 4px; }
  .meta .m { color:var(--mut); font-size:13px; }
  .picker { display:flex; gap:8px; margin:22px 0 4px; flex-wrap:wrap; }
  .picker button { background:#1a2432; color:var(--mut); font-size:14px; padding:9px 16px; }
  .picker button.on { background:var(--acc2); color:#04121f; }
  h3 { font-size:14px; margin:22px 0 8px; color:var(--mut); text-transform:uppercase; letter-spacing:.04em; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:9px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--mut); font-weight:600; font-size:11px; text-transform:uppercase; white-space:nowrap; }
  tr:hover td { background:#101823; }
  a.dl { display:inline-block; padding:6px 11px; border-radius:8px; background:var(--acc2); color:#04121f; font-weight:600; text-decoration:none; font-size:12px; white-space:nowrap; }
  a.dl.alt { background:#2b3a4d; color:var(--fg); }
  .tag { display:inline-block; padding:1px 7px; border-radius:6px; background:#22303f; color:var(--mut); font-size:11px; }
  .dir { display:flex; gap:6px; align-items:center; max-width:340px; }
  .dir input { flex:1; font:12px/1.3 ui-monospace,Menlo,Consolas,monospace; padding:5px 7px; border-radius:6px; border:1px solid var(--line); background:#0e141d; color:var(--mut); min-width:0; }
  .copy { padding:5px 9px; font-size:11px; border-radius:6px; background:#22303f; color:var(--fg); cursor:pointer; white-space:nowrap; }
  .copy.done { background:var(--grn); color:#04120a; }
  .note { margin-top:26px; color:var(--mut); font-size:12px; }
  code { background:#0e141d; padding:2px 6px; border-radius:5px; }
  .tabs { display:flex; gap:6px; margin:14px 0 0; }
  .tabs button { background:#1a2432; color:var(--mut); font-size:13px; padding:7px 14px; border-radius:999px; }
  .tabs button.on { background:var(--acc2); color:#04121f; }
  #results { margin-top:18px; display:none; }
  #results.show { display:block; }
  .cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); }
  .card { display:flex; gap:10px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:9px; cursor:pointer; text-align:left; }
  .card:hover { border-color:var(--acc2); }
  .card img { width:120px; height:68px; object-fit:cover; border-radius:6px; background:#000; flex:0 0 auto; }
  .card .t { font-size:13px; font-weight:600; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .card .m { color:var(--mut); font-size:11.5px; margin-top:4px; }
  .card.chan { align-items:center; }
  .card.chan img { width:52px; height:52px; border-radius:50%; }
  #more { margin-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Vidmate YT Downloader</h1>
  <div class="sub">Search YouTube or paste a link / video id — then pick Audio, Video, or All formats.</div>

  <form id="f">
    <input id="q" type="text" placeholder="Search YouTube, or paste a link / video id…" autocomplete="off" autofocus>
    <button id="go" type="submit">Search</button>
  </form>
  <div class="tabs" id="tabs">
    <button data-type="video" class="on">Videos</button>
    <button data-type="channel">Channels</button>
    <button data-type="playlist">Playlists</button>
    <button data-type="all">All</button>
  </div>
  <div class="msg" id="msg"></div>

  <div id="results">
    <div class="cards" id="cards"></div>
    <button id="more" class="copy" style="display:none">Load more</button>
  </div>

  <div class="vid" id="vid">
    <div class="meta">
      <img id="thumb" alt="">
      <div>
        <h2 id="title"></h2>
        <div class="m" id="sub"></div>
      </div>
    </div>

    <div class="picker" id="picker">
      <button data-kind="video" class="on">Video</button>
      <button data-kind="audio">Audio</button>
      <button data-kind="muxed">Video+Audio (single)</button>
      <button data-kind="all">All</button>
    </div>

    <h3 id="tblTitle">Video only (no sound)</h3>
    <table>
      <thead><tr>
        <th>Quality</th><th>Container</th><th>Codec</th><th>Dims</th><th>Size</th><th>Bitrate</th><th>itag</th>
        <th>Direct URL</th><th>Download</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="note">Direct URL = raw googlevideo link (expires). Download = proxied through this server (always works, Range/seek supported). VISIONOS returns video and audio as separate tracks, so pick the Audio row for sound or the Video row for picture.</div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const fmtSize = (n) => !n ? "" : n > 1e9 ? (n/1e9).toFixed(2)+" GB" : n > 1e6 ? (n/1e6).toFixed(1)+" MB" : (n/1e3).toFixed(0)+" KB";
let DATA = null, KIND = "video";

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function row(f, base, v) {
  const dl = base + "/api/download?v=" + encodeURIComponent(v) + "&itag=" + f.itag + "&dl=1";
  const direct = f.directUrl;
  const dims = f.width && f.height ? f.width + "×" + f.height : (f.audioSampleRate ? f.audioSampleRate + " Hz" : "");
  const fps = f.fps ? f.fps + "fps" : "";
  return '<tr>'
    + '<td><b>' + esc(f.quality || "-") + '</b></td>'
    + '<td>' + esc(f.container) + '</td>'
    + '<td><span class="tag">' + esc(f.codec) + '</span></td>'
    + '<td>' + [dims, fps].filter(Boolean).join(" ") + '</td>'
    + '<td>' + fmtSize(f.contentLength) + '</td>'
    + '<td>' + Math.round(f.bitrate/1000) + ' kbps</td>'
    + '<td>' + f.itag + '</td>'
    + '<td><div class="dir"><input readonly value="' + esc(direct) + '"><button class="copy" data-u="' + esc(direct) + '">Copy</button></div></td>'
    + '<td><a class="dl" href="' + dl + '">Download</a> '
    + '<a class="dl alt" href="' + base + "/api/download?v=" + encodeURIComponent(v) + "&itag=" + f.itag + '" target="_blank">Open</a>'
    + '</td></tr>';
}

function renderRows() {
  if (!DATA) return;
  const base = location.origin, v = DATA.video.videoId;
  let list = DATA.formats;
  if (KIND !== "all") list = list.filter(f => f.kind === KIND);
  list = list.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || b.bitrate - a.bitrate);
  $("tblTitle").textContent =
    KIND === "video" ? "Video only (no sound)" :
    KIND === "audio" ? "Audio only" :
    KIND === "muxed" ? "Video + audio (single file)" : "All formats";
  $("rows").innerHTML = list.length
    ? list.map(f => row(f, base, v)).join("")
    : '<tr><td colspan="9" style="color:var(--mut)">none available for this type</td></tr>';
  document.querySelectorAll(".copy").forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.u).then(() => {
      b.textContent = "Copied"; b.classList.add("done");
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1200);
    });
  });
}

document.querySelectorAll("#picker button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#picker button").forEach(x => x.classList.remove("on"));
  b.classList.add("on"); KIND = b.dataset.kind; renderRows();
});

async function load(q) {
  $("go").disabled = true;
  $("msg").className = "msg";
  $("msg").textContent = "Fetching formats…";
  $("vid").classList.remove("show");
  try {
    const r = await fetch("/api/info?v=" + encodeURIComponent(q));
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "failed");
    DATA = d;
    const v = d.video.videoId;
    $("thumb").src = "https://i.ytimg.com/vi/" + v + "/mqdefault.jpg";
    $("title").textContent = d.video.title;
    $("sub").textContent = d.video.author + " · " + Math.floor(d.video.lengthSeconds/60) + "m " + (d.video.lengthSeconds%60) + "s · " + d.count + " formats · links valid " + Math.round(d.expiresInSeconds/3600) + "h";
    $("msg").textContent = "";
    $("vid").classList.add("show");
    renderRows();
  } catch (err) {
    $("msg").className = "msg err";
    $("msg").textContent = "Error: " + err.message;
  } finally {
    $("go").disabled = false;
  }
}

const initial = new URLSearchParams(location.search).get("v");
if (initial) { $("q").value = initial; load(initial); }

/* ---------- search ---------- */
let STYPE = "video", SCONT = null, SLASTQ = "";

function isUrl(s) {
  return /^https?:/i.test(s) || /^[A-Za-z0-9_-]{11}$/.test(s) || s.toLowerCase().includes("youtu.be");
}

function fmtViews(t) { return t || ""; }

function cardFor(r) {
  if (r.kind === "video") {
    const m = [r.channel, r.lengthText, fmtViews(r.viewCountText), r.publishedTimeText].filter(Boolean).join(" · ");
    return '<div class="card" data-v="' + esc(r.videoId) + '">'
      + '<img loading="lazy" src="' + esc(r.thumbnail || ("https://i.ytimg.com/vi/" + r.videoId + "/mqdefault.jpg")) + '" alt="">'
      + '<div><div class="t">' + esc(r.title) + '</div><div class="m">' + esc(m) + '</div></div></div>';
  }
  if (r.kind === "channel") {
    const m = [r.handle, r.subscriberCountText].filter(Boolean).join(" · ");
    return '<div class="card chan" data-c="' + esc(r.channelId) + '">'
      + '<img loading="lazy" src="' + esc(r.thumbnail || "") + '" alt="">'
      + '<div><div class="t">' + esc(r.title) + '</div><div class="m">' + esc(m) + '</div></div></div>';
  }
  const m = [r.channel, r.videoCountText].filter(Boolean).join(" · ");
  return '<div class="card">'
    + '<img loading="lazy" src="' + esc(r.thumbnail || "") + '" alt="">'
    + '<div><div class="t">' + esc(r.title) + '</div><div class="m">' + esc(m) + '</div></div></div>';
}

function bindCards() {
  document.querySelectorAll(".card[data-v]").forEach(c => c.onclick = () => {
    const id = c.dataset.v;
    $("q").value = id;
    const u = new URL(location.href); u.searchParams.set("v", id); history.replaceState(null, "", u);
    $("results").classList.remove("show");
    load(id);
    $("vid").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function search(q, append) {
  if (!q && !SCONT) return;
  if (!append) { STYPE = document.querySelector("#tabs button.on").dataset.type; SCONT = null; SLASTQ = q; }
  $("msg").className = "msg";
  $("msg").textContent = "Searching…";
  if (!append) { $("cards").innerHTML = ""; $("results").classList.remove("show"); $("vid").classList.remove("show"); }
  try {
    const url = "/api/search?q=" + encodeURIComponent(SLASTQ) + "&type=" + STYPE
      + (append && SCONT ? "&continuation=" + encodeURIComponent(SCONT) : "");
    const d = await (await fetch(url)).json();
    if (!d.ok) throw new Error(d.error || "search failed");
    $("cards").insertAdjacentHTML("beforeend", d.results.map(cardFor).join(""));
    SCONT = d.continuation;
    $("more").style.display = SCONT ? "inline-block" : "none";
    $("results").classList.add("show");
    $("msg").textContent = d.count ? "" : "No results.";
    bindCards();
  } catch (err) {
    $("msg").className = "msg err";
    $("msg").textContent = "Error: " + err.message;
  }
}

document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#tabs button").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  if (SLASTQ) search(SLASTQ, false);
});
$("more").onclick = () => search(SLASTQ, true);

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  const u = new URL(location.href); u.searchParams.delete("v"); history.replaceState(null, "", u);
  if (isUrl(q)) { $("results").classList.remove("show"); load(q); }
  else search(q, false);
});
</script>
</body>
</html>`;
}
