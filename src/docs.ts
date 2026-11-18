/**
 * Site API documentation, served from `GET /api/info`. This is the developer
 * reference: every route this server exposes, with its parameters, a real
 * example response and the recipes needed to build a client. Keep it in sync
 * with `index.ts`, `music-routes.ts` and `catalog.ts`.
 */
import { upstreamCatalog } from "./catalog.js";

export interface RouteParam {
  name: string;
  required: boolean;
  description: string;
}

export interface SiteRoute {
  path: string;
  group: "Meta" | "Video" | "Music";
  summary: string;
  params: RouteParam[];
  example: string;
  returns: string;
  /** A real (trimmed) response body, so a client author can see the shape. */
  response?: unknown;
  notes?: string[];
}

const ROUTES: SiteRoute[] = [
  {
    path: "/",
    group: "Meta",
    summary: "Browser UI: search YouTube or paste a link, then pick a format.",
    params: [{ name: "v", required: false, description: "Video id or URL to open on load." }],
    example: "/?v=W0DM5lcj6mw",
    returns: "HTML",
    notes: ["Deep-links straight to a video's format table."],
  },
  {
    path: "/health",
    group: "Meta",
    summary: "Liveness, uptime, and the client and proxy the server booted with.",
    params: [],
    example: "/health",
    returns: "JSON",
    response: {
      ok: true,
      uptimeSeconds: 291,
      client: "VISIONOS",
      clientVersion: "1.02",
      musicClient: "WEB_REMIX",
      proxy: "socks5://127.0.0.1:40000",
      host: "https://youtubei.googleapis.com",
    },
    notes: ["Use it as a readiness probe; it never calls upstream."],
  },
  {
    path: "/api",
    group: "Meta",
    summary: "Machine-readable catalogue of the upstream APIs this server calls.",
    params: [],
    example: "/api",
    returns: "JSON",
    response: {
      ok: true,
      name: "vidmate-yt-api",
      videoClient: "VISIONOS 1.02",
      musicClient: "WEB_REMIX 1.20261115.14.00",
      count: 7,
      apis: [
        {
          id: "player",
          method: "POST",
          host: "https://youtubei.googleapis.com",
          path: "/youtubei/v1/player",
          client: "VISIONOS 1.02",
          usedBy: ["/api/info", "/api/link", "/api/download", "/api/music/song"],
          requiresProxy: true,
          verified: true,
        },
      ],
      routes: ["GET /", "GET /health", "GET /api", "GET /api/info", "…"],
    },
    notes: ["The same catalogue is embedded in this page as JSON under `apis`."],
  },
  {
    path: "/api/doc",
    group: "Meta",
    summary: "This page: every route on this server, with params, examples and responses.",
    params: [{ name: "json", required: false, description: "Force the JSON form in a browser." }],
    example: "/api/doc",
    returns: "HTML or JSON",
    response: {
      ok: true,
      name: "vidmate-yt-api",
      base: "https://xro-yt-api.onrender.com",
      conventions: { success: 'Every JSON response carries "ok": true.', failure: '"ok": false with an "error" string.' },
      recipes: [{ goal: "Search and download a video", steps: ["GET /api/search?q=<query>", "GET /api/info?v=<id>", "GET /api/download?v=<id>&itag=<itag>"] }],
      count: 18,
      routes: [
        {
          path: "/api/info",
          group: "Video",
          summary: "Metadata and every format for one video, with direct and proxied links.",
          params: [{ name: "v", required: true, description: "Video id or URL. Aliases: url, id." }],
          example: "/api/info?v=W0DM5lcj6mw&format=audio",
          returns: "JSON",
        },
      ],
      apis: ["…the same list as GET /api…"],
    },
    notes: [
      "Browsers get the page; every other client gets JSON. Add `?json` to force JSON.",
      "Point a client at this endpoint to discover the rest of the surface at runtime.",
    ],
  },
  {
    path: "/api/search",
    group: "Video",
    summary: "Search YouTube for videos, channels or playlists.",
    params: [
      { name: "q", required: true, description: "Query text. Aliases: query, search." },
      { name: "type", required: false, description: "video (default) | channel | playlist | all." },
      { name: "continuation", required: false, description: "Token from the previous page." },
    ],
    example: "/api/search?q=believer&type=video",
    returns: "JSON",
    response: {
      ok: true,
      query: "believer",
      type: "video",
      count: 20,
      continuation: "EqADEgt...",
      results: [
        {
          kind: "video",
          videoId: "W0DM5lcj6mw",
          title: "Imagine Dragons - Believer (Lyrics)",
          channel: "7clouds",
          channelId: "UC...",
          lengthSeconds: 204,
          lengthText: "3:24",
          viewCount: 731587549,
          viewCountText: "731M views",
          publishedTimeText: "7 years ago",
          thumbnail: "https://.../mqdefault.jpg",
          url: "https://www.youtube.com/watch?v=W0DM5lcj6mw",
          infoUrl: "https://xro-yt-api.onrender.com/api/info?v=W0DM5lcj6mw",
          linkUrl: "https://xro-yt-api.onrender.com/api/link?v=W0DM5lcj6mw",
          downloadUrl: "https://xro-yt-api.onrender.com/api/link?v=W0DM5lcj6mw",
          audioUrl: "https://xro-yt-api.onrender.com/api/link?v=W0DM5lcj6mw&format=audio",
        },
      ],
    },
    notes: [
      "Video results carry ready-made `infoUrl`, `linkUrl`, `downloadUrl` and `audioUrl`.",
      "Pass the returned `continuation` back to page; it is `null` on the last page.",
      "Channels return `kind: \"channel\"` with `channelId`; playlists return `kind: \"playlist\"` with `playlistId`.",
    ],
  },
  {
    path: "/api/info",
    group: "Video",
    summary: "Metadata and every format for one video, with direct and proxied links.",
    params: [
      { name: "v", required: true, description: "Video id or URL. Aliases: url, id." },
      { name: "format", required: false, description: "video | audio | muxed." },
      { name: "maxHeight", required: false, description: "Drop video tracks taller than this." },
    ],
    example: "/api/info?v=W0DM5lcj6mw&format=audio",
    returns: "JSON",
    response: {
      ok: true,
      count: 23,
      expiresInSeconds: 21540,
      hlsManifestUrl: "https://manifest.googlevideo.com/...",
      video: {
        videoId: "W0DM5lcj6mw",
        title: "Imagine Dragons - Believer (Lyrics)",
        author: "7clouds",
        lengthSeconds: 204,
        viewCount: 731587549,
      },
      formats: [
        {
          itag: 248,
          kind: "video",
          quality: "1080p",
          container: "webm",
          codec: "vp9",
          width: 1920,
          height: 1080,
          fps: 30,
          bitrate: 1426245,
          contentLength: "54123456",
          directUrl: "https://...googlevideo.com/...",
          proxyUrl: "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=248",
        },
      ],
    },
    notes: [
      "`directUrl` is short-lived and bound to this server's IP — use `proxyUrl` in clients.",
      "`kind` is `video` or `audio`; VISIONOS returns them as separate tracks, so there is no muxed row.",
      "`expiresInSeconds` tells you how long the signed URLs stay valid.",
    ],
  },
  {
    path: "/api/link",
    group: "Video",
    summary: "Pick one playable format and return ready-to-use URLs.",
    params: [
      { name: "v", required: true, description: "Video id or URL. Aliases: url, id." },
      { name: "format", required: false, description: "video (default) | audio | muxed." },
      { name: "quality", required: false, description: "best (default) | worst | a height such as 720." },
      { name: "itag", required: false, description: "Pin an exact format." },
    ],
    example: "/api/link?v=W0DM5lcj6mw&format=audio",
    returns: "JSON",
    response: {
      ok: true,
      expiresInSeconds: 21540,
      video: { videoId: "W0DM5lcj6mw", title: "Imagine Dragons - Believer (Lyrics)", author: "7clouds", lengthSeconds: 204 },
      selected: {
        video: { itag: 251, kind: "audio", quality: "AUDIO_QUALITY_MEDIUM", container: "webm" },
        audio: { itag: 251, kind: "audio", quality: "AUDIO_QUALITY_MEDIUM", container: "webm" },
      },
      downloadUrl: "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=251",
      directUrl: "https://...googlevideo.com/...",
      audioUrl: "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=251",
      audioDirectUrl: "https://...googlevideo.com/...",
    },
    notes: [
      "Simpler than `/api/info` when you just want something playable.",
      "`format=muxed` falls back to the best video-only track, because VISIONOS returns no muxed track.",
    ],
  },
  {
    path: "/api/download",
    group: "Video",
    summary: "Stream the media bytes with Range support. Add &dl=1 to force a file download.",
    params: [
      { name: "v", required: true, description: "Video id or URL. Aliases: url, id." },
      { name: "itag", required: true, description: "Format to stream, taken from /api/info." },
      { name: "dl", required: false, description: "Present at all sends an attachment disposition." },
    ],
    example: "/api/download?v=W0DM5lcj6mw&itag=140",
    returns: "media (bytes)",
    notes: [
      "Supports `HEAD` and `Range`; range requests answer `206 Partial Content`, so players can seek.",
      "Use this instead of `directUrl`: the upstream link is bound to this server's egress IP.",
      "`&dl=1` adds `Content-Disposition: attachment` with a filename.",
    ],
  },
  {
    path: "/api/music/search",
    group: "Music",
    summary: "Search the YouTube Music catalogue.",
    params: [
      { name: "q", required: true, description: "Query text. Alias: query." },
      { name: "type", required: false, description: "songs (default) | videos | albums | artists | playlists." },
      { name: "continuation", required: false, description: "Token from the previous page." },
    ],
    example: "/api/music/search?q=believer&type=songs",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      clientVersion: "1.20261115.14.00",
      host: "https://music.youtube.com",
      query: "believer",
      type: "songs",
      count: 20,
      results: [
        {
          kind: "song",
          title: "Believer",
          subtitle: "Imagine Dragons • Evolve • 3:25",
          videoId: "Kx7B-XvmFtE",
          duration: "3:25",
          durationSeconds: 205,
          thumbnail: "https://yt3.googleusercontent.com/...",
        },
      ],
      continuation: "EqEDEghiZWxpZXZlchqUA0Vn...",
    },
    notes: [
      "Songs, videos and albums carry `videoId` or `browseId`; artists carry `browseId` only.",
      "Feed a `videoId` to `/api/music/song`, `/api/info` or `/api/link` to stream it.",
    ],
  },
  {
    path: "/api/music/home",
    group: "Music",
    summary: "The YouTube Music home shelves.",
    params: [],
    example: "/api/music/home",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      count: 2,
      shelves: [
        {
          title: "Pump it up",
          items: [
            {
              kind: "playlist",
              title: "Wide Open Country",
              subtitle: "Lainey Wilson, Dierks Bentley, Kenny Chesney, Morgan Wallen",
              browseId: "VLRDCLAK5uy_m74vq-4_Q1Ayo52oKHdUtkcbUb8moNzMM",
              playlistId: "RDCLAK5uy_m74vq-4_Q1Ayo52oKHdUtkcbUb8moNzMM",
              thumbnail: "https://yt3.googleusercontent.com/...",
            },
          ],
        },
      ],
    },
  },
  {
    path: "/api/music/artist",
    group: "Music",
    summary: "An artist's profile and shelves.",
    params: [{ name: "id", required: true, description: "Channel id. Alias: channelId." }],
    example: "/api/music/artist?id=UCDxKh1gFWeYsqePvgVzmPoQ",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      artist: { title: "Arijit Singh", description: "Arijit Singh is an Indian singer and composer.…", subscribers: "6.59M", thumbnail: "https://..." },
      topSongs: [{ kind: "song", title: "Tu Mil Jaaye", videoId: "XPDec1vxj6s", thumbnail: "https://..." }],
      albums: [{ kind: "album", title: "Nach Party", subtitle: "2026", browseId: "MPREb_1VSRbySMG5W" }],
      singles: [{ kind: "album", title: "KING", browseId: "MPREb_p9UzAek29Dn" }],
      videos: [{ kind: "song", title: "Purane Din", videoId: "TvVDycXSlvQ" }],
      related: [{ kind: "artist", title: "Sa…", browseId: "UC…" }],
      shelves: ["…"],
    },
    notes: ["`albums` and `singles` give `browseId` values for `/api/music/album`."],
  },
  {
    path: "/api/music/artist/songs",
    group: "Music",
    summary: "An artist's top songs.",
    params: [{ name: "id", required: true, description: "Channel id. Alias: channelId." }],
    example: "/api/music/artist/songs?id=UCDxKh1gFWeYsqePvgVzmPoQ",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      header: null,
      items: [{ kind: "song", title: "Tu Mil Jaaye", videoId: "XPDec1vxj6s", duration: "5:16", durationSeconds: 316 }],
      continuation: "4qmFsgL1AhIcTVBBRFVDRHhLaDFnRldlWXNxZVB2Z1Z6bVBvURrUAj...",
    },
    notes: ["Resolves the artist's `MPAD<channelId>` playlist; page with `continuation`."],
  },
  {
    path: "/api/music/album",
    group: "Music",
    summary: "An album and its tracks.",
    params: [{ name: "id", required: true, description: "Album id. Alias: browseId." }],
    example: "/api/music/album?id=MPREb_p9UzAek29Dn",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      header: {
        title: "KING",
        subtitle: "Single • 2026",
        secondSubtitle: "1 song • 5 minutes, 16 seconds",
        thumbnail: "https://...",
      },
      items: [{ kind: "song", title: 'Tu Mil Jaaye (From "KING")', videoId: "BPZkZpGMpXA", duration: "5:16", durationSeconds: 316 }],
    },
    notes: ["404 when the id resolves to no tracks."],
  },
  {
    path: "/api/music/playlist",
    group: "Music",
    summary: "A playlist and its tracks.",
    params: [
      { name: "id", required: true, description: "Playlist id. Alias: list." },
      { name: "continuation", required: false, description: "Token from the previous page." },
    ],
    example: "/api/music/playlist?id=PL2WAE39ngDYNsU2pAE6Vv6Cwlp_Sjp_lc",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      header: {
        title: "Arijit Singh sad songs",
        subtitle: "Playlist • 2026",
        secondSubtitle: "478K views • 23 tracks • 1 hour, 52 minutes",
        thumbnail: "https://...",
      },
      items: [
        {
          kind: "song",
          title: "Ve Kamleya (LYRICS) Arijit Singh & Shreya Ghoshal",
          subtitle: "LTL LYRICS",
          videoId: "xXFbFUcic_0",
          duration: "4:17",
          durationSeconds: 257,
          thumbnail: "https://...",
        },
      ],
      continuation: "4qmFsgI0EiRWTFBMMldBRTM5bmdEWU5zVTJwQUU2VnY2Q3dscF9TanBfbGMaDGtnRURDTT...",
    },
    notes: ["Accepts `VL…` and `PL…` ids; page with `continuation`."],
  },
  {
    path: "/api/music/trending",
    group: "Music",
    summary: "Trending songs and videos.",
    params: [],
    example: "/api/music/trending",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      count: 8,
      shelves: [
        {
          title: "Video charts",
          items: [
            {
              kind: "playlist",
              title: "Top 100 Live Performances - United States",
              subtitle: "Chart • YouTube Charts",
              browseId: "VLPL4fGSI1pDJn4yCNzulPkUbxgr4pl0gmI-",
              playlistId: "PL4fGSI1pDJn4yCNzulPkUbxgr4pl0gmI-",
            },
          ],
        },
      ],
    },
  },
  {
    path: "/api/music/radio",
    group: "Music",
    summary: "The autoplay queue that starts from a track.",
    params: [
      { name: "id", required: true, description: "Seed video id. Alias: v." },
      { name: "continuation", required: false, description: "Token from the previous page." },
    ],
    example: "/api/music/radio?id=W0DM5lcj6mw",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      header: null,
      items: [
        {
          kind: "song",
          title: "Imagine Dragons - Believer (Lyrics)",
          subtitle: "Imagine Dragons • 731M views • 6.6M likes",
          videoId: "W0DM5lcj6mw",
          duration: "3:25",
          durationSeconds: 205,
          thumbnail: "https://...",
        },
      ],
      continuation: "…",
    },
    notes: ["Backed by `next?playlistId=RDAMVM<videoId>`; the seed track comes back first."],
  },
  {
    path: "/api/music/song",
    group: "Music",
    summary: "One track's metadata and links to its audio.",
    params: [{ name: "id", required: true, description: "Video id. Alias: v." }],
    example: "/api/music/song?id=W0DM5lcj6mw",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      song: {
        videoId: "W0DM5lcj6mw",
        title: "Imagine Dragons - Believer (Lyrics)",
        artist: "7clouds",
        lengthSeconds: 204,
        viewCount: 731587549,
        thumbnail: "https://i.ytimg.com/vi/W0DM5lcj6mw/hqdefault.jpg",
      },
      expiresInSeconds: 21540,
      formatCount: 23,
      links: {
        info: "https://xro-yt-api.onrender.com/api/info?v=W0DM5lcj6mw",
        download: "https://xro-yt-api.onrender.com/api/link?v=W0DM5lcj6mw&format=audio",
      },
    },
    notes: ["`links.download` is the audio-only stream; `links.info` lists every format."],
  },
  {
    path: "/api/music/lyrics",
    group: "Music",
    summary: "Lyrics for a track, when YouTube Music has them.",
    params: [{ name: "id", required: true, description: "Video id. Alias: v." }],
    example: "/api/music/lyrics?id=W0DM5lcj6mw",
    returns: "JSON",
    response: {
      ok: true,
      client: "WEB_REMIX",
      lyrics: "First things first, I'ma say all the words inside my head\nI'm fired up…",
      browseId: "MPLYt_4CkvE8X6K3e",
    },
    notes: ["404 when the track has no lyrics."],
  },
];

export function siteRoutes(): SiteRoute[] {
  return ROUTES;
}

const RECIPES = [
  {
    goal: "Search and download a video",
    steps: [
      "GET /api/search?q=<query>&type=video → take results[0].videoId",
      "GET /api/info?v=<videoId> → pick a format by itag",
      "GET /api/download?v=<videoId>&itag=<itag> → stream the bytes",
    ],
  },
  {
    goal: "Play a music track",
    steps: [
      "GET /api/music/search?q=<query>&type=songs → take results[0].videoId",
      "GET /api/music/song?id=<videoId> → metadata + links",
      "GET /api/link?v=<videoId>&format=audio → audio stream URL",
    ],
  },
  {
    goal: "Browse an artist",
    steps: [
      "GET /api/music/artist?id=<channelId> → topSongs, albums, singles",
      "GET /api/music/album?id=<browseId> → tracks, each with videoId",
      "GET /api/music/radio?id=<videoId> → autoplay queue",
    ],
  },
];

const CONVENTIONS = {
  success: 'Every JSON response carries "ok": true.',
  failure: '"ok": false with an "error" string. Status 400 bad input, 404 no match, 502 upstream failure.',
  auth: "No API key. The server holds the upstream keys; clients only need the base URL.",
  network:
    "The server reaches YouTube through a proxy. Raw directUrl links are bound to that egress IP, so stream through /api/download instead.",
};

export function docsPayload(base: string) {
  const routes = siteRoutes();
  return {
    ok: true,
    name: "vidmate-yt-api",
    base,
    conventions: CONVENTIONS,
    recipes: RECIPES,
    count: routes.length,
    routes,
    apis: upstreamCatalog(),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function paramTable(r: SiteRoute): string {
  if (r.params.length === 0) return '<div class="none">no parameters</div>';
  return (
    "<table><thead><tr><th>Param</th><th>Req</th><th>Description</th></tr></thead><tbody>" +
    r.params
      .map(
        (p) =>
          "<tr><td><code>" +
          esc(p.name) +
          "</code></td><td>" +
          (p.required ? "yes" : "no") +
          "</td><td>" +
          esc(p.description) +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}

function routeBlock(base: string, r: SiteRoute): string {
  const curl = r.returns.startsWith("media")
    ? `curl -L -o out.bin "${base}${r.example}"`
    : `curl "${base}${r.example}"`;
  return (
    '<section class="route"><h3>GET ' +
    esc(r.path) +
    "</h3><p>" +
    esc(r.summary) +
    '</p><div class="ex">Example: <a href="' +
    esc(base + r.example) +
    '">' +
    esc(r.example) +
    '</a> <span class="tag">' +
    esc(r.returns) +
    "</span></div>" +
    paramTable(r) +
    (r.notes && r.notes.length
      ? '<ul class="notes">' + r.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>"
      : "") +
    (r.response
      ? '<div class="snippet"><div class="sniphead">Response</div><pre>' +
        esc(JSON.stringify(r.response, null, 2)) +
        "</pre></div>"
      : "") +
    '<div class="snippet"><div class="sniphead">Request</div><pre>' + esc(curl) + "</pre></div>" +
    "</section>"
  );
}

function recipeBlock(rec: { goal: string; steps: string[] }): string {
  return (
    '<div class="recipe"><div class="rgoal">' +
    esc(rec.goal) +
    "</div><ol>" +
    rec.steps.map((s) => "<li><code>" + esc(s) + "</code></li>").join("") +
    "</ol></div>"
  );
}

export function renderDocs(base: string): string {
  const routes = siteRoutes();
  const apis = upstreamCatalog();
  const groups: Array<SiteRoute["group"]> = ["Meta", "Video", "Music"];
  const byGroup = groups
    .map(
      (g) =>
        '<h2 id="' +
        g.toLowerCase() +
        '">' +
        g +
        "</h2>\n" +
        routes.filter((r) => r.group === g).map((r) => routeBlock(base, r)).join("\n"),
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vidmate-yt-api — API reference</title>
<style>
  :root { --bg:#0b0f17; --card:#141b26; --line:#243040; --fg:#e7eef8; --mut:#8ba0b8; --acc2:#4dabff; --grn:#2fbf71; --warn:#ffcc66; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  .wrap { max-width:1000px; margin:0 auto; padding:28px 18px 70px; }
  h1 { font-size:26px; margin:0 0 6px; }
  h2 { font-size:13px; margin:38px 0 12px; color:var(--mut); text-transform:uppercase; letter-spacing:.08em; }
  h3 { font-size:14.5px; margin:0 0 6px; font-family:ui-monospace,Menlo,Consolas,monospace; color:var(--acc2); }
  .sub { color:var(--mut); font-size:13.5px; }
  .sub code, .kv code { background:#0e141d; padding:2px 6px; border-radius:5px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); }
  .kv { font-size:13px; }
  .kv b { display:block; color:var(--mut); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:2px; }
  .route { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:14px; }
  .route p { margin:0 0 10px; font-size:14px; }
  .ex { margin-bottom:12px; font-size:13px; color:var(--mut); }
  .ex a { color:var(--grn); font-family:ui-monospace,Menlo,Consolas,monospace; text-decoration:none; word-break:break-all; }
  .ex a:hover { text-decoration:underline; }
  .tag { display:inline-block; padding:1px 8px; border-radius:6px; background:#22303f; color:var(--mut); font-size:11px; margin-left:6px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:10px; }
  th,td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--mut); font-weight:600; font-size:11px; text-transform:uppercase; white-space:nowrap; }
  tr:last-child td { border-bottom:0; }
  .none { color:var(--mut); font-size:13px; margin-bottom:10px; }
  code { background:#0e141d; padding:2px 6px; border-radius:5px; font-size:12.5px; }
  ul.notes { margin:0 0 12px; padding-left:20px; font-size:13px; color:var(--mut); }
  ul.notes li { margin-bottom:3px; }
  .snippet { margin-top:8px; }
  .sniphead { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--mut); margin-bottom:4px; }
  pre { background:#0e141d; border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace; margin:0; max-height:420px; }
  .recipe { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 18px; margin-bottom:10px; }
  .rgoal { font-weight:600; margin-bottom:6px; }
  .recipe ol { margin:0; padding-left:22px; font-size:13px; color:var(--mut); }
  .recipe li { margin-bottom:4px; }
  .api { font-size:13px; margin-bottom:10px; }
  .api .id { color:var(--acc2); font-family:ui-monospace,Menlo,Consolas,monospace; font-weight:600; }
  .api .m { color:var(--mut); }
  .warn { border-left:3px solid var(--warn); padding:8px 12px; background:#1a1a12; border-radius:6px; font-size:13px; color:var(--mut); margin-bottom:16px; }
  .note { margin-top:34px; color:var(--mut); font-size:12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>vidmate-yt-api</h1>
  <div class="sub">Unofficial YouTube &amp; YouTube Music API. Every route this server exposes, with parameters, real responses and the recipes to build a client. Base URL <code>${esc(base)}</code>.</div>

  <h2 id="start">Getting started</h2>
  <div class="card"><div class="grid">
    <div class="kv"><b>Success</b>Every JSON response carries <code>"ok": true</code>.</div>
    <div class="kv"><b>Failure</b><code>"ok": false</code> plus <code>"error"</code>. 400 bad input, 404 no match, 502 upstream failure.</div>
    <div class="kv"><b>Auth</b>None. The server holds the upstream keys; you only need the base URL.</div>
    <div class="kv"><b>Formats</b>Browser gets a page here; add <code>?json</code> for JSON. Other routes answer JSON.</div>
  </div></div>
  <div class="warn">The server reaches YouTube through a proxy, and the signed <code>directUrl</code> links are bound to that egress IP. Stream through <code>/api/download</code> rather than handing <code>directUrl</code> to a client.</div>

  <h2>Recipes</h2>
${RECIPES.map(recipeBlock).join("\n")}

${byGroup}

  <h2 id="upstream">Upstream APIs</h2>
  <div class="card">
${apis
  .map(
    (a) =>
      '  <div class="api"><span class="id">' +
      esc(a.id) +
      '</span> <span class="m">' +
      esc(a.method) +
      " " +
      esc(a.host + a.path) +
      " · client " +
      esc(a.client) +
      (a.requiresProxy ? " · needs proxy" : "") +
      '</span><br><span class="m">used by ' +
      esc(a.usedBy.join(", ")) +
      "</span>" +
      (a.note ? '<br><span class="m">' + esc(a.note) + "</span>" : "") +
      "</div>",
  )
  .join("\n")}
  </div>

  <div class="note">Media URLs expire; each response reports <code>expiresInSeconds</code>. This page is also available as JSON at <code>${esc(base)}/api/doc?json</code>.</div>
</div>
</body>
</html>`;
}
