# vidmate-api

A small Node.js + TypeScript HTTP server that, given a media id or URL, returns
**direct and proxied download links** for every available audio/video track, plus
keyword **search**, and the full **YouTube Music** catalogue.

The upstream API is called with the client identity recovered from the Vidmate
APK, which (unlike most web/mobile clients) hands out the *entire* media file
from a flagged/datacenter IP and needs no extra token. The server then proxies
the media bytes so the links work straight from a browser or `curl` (no CORS or
hotlink problems) and supports `Range` seeking.

## Features

- Keyword **search** with Video / Channel / Playlist filters and cursor paging.
- **YouTube Music** catalogue: search (songs/videos/albums/artists/playlists),
  home, artist (top songs + shelves), album, playlist, trending, radio/queue,
  lyrics — see [`docs/API.md`](docs/API.md).
- `GET /api/doc` — the **API reference**: every route this server exposes, with
  params and examples, as a page in a browser or JSON anywhere else.
- `GET /api` — a machine-readable **catalogue of every upstream API** the server
  calls (client, params, proxy requirement, which routes use it).
- Per-video **format listing** (itag, codec, size, bitrate, dimensions).
- **Direct** upstream URL **and** a **proxied** URL for every track.
- **Range / seek** support and `HEAD` on all streamed downloads.
- Built-in **browser UI** at `/` (search box + format table).
- Runs **behind Cloudflare WARP** in Docker, with automatic QUIC → HTTP/2
  fallback, so it works from hosts that block UDP.

## Requirements

- Node.js >= 20 (tested on 24).
- Optional: a SOCKS5 proxy for the egress that mints the URLs, e.g. Cloudflare
  WARP (`socks5://127.0.0.1:40000`) or WireGuard via wireproxy.

> The media URL is bound to the IP that requested it. If you mint the URL through
> a proxy, the media fetch must use the **same** proxy. Keep `PROXY` set
> consistently.

## Quick start

```bash
npm install
npm run dev          # tsx watch, http://localhost:8787
# or production:
npm run build && npm start
```

With a proxy:

```bash
PROXY=socks5://127.0.0.1:40000 npm run dev
```

## Run with Docker (WARP included)

The image bundles Cloudflare WARP (via [usque](https://github.com/Diniboy1123/usque))
and starts it as a loopback SOCKS5 proxy before the server, so downloads work
from a datacenter host with no external proxy.

```bash
docker build -t vidmate-api .
docker run -d --name vidmate-api -p 8787:8787 -v warp-data:/data vidmate-api
# then open http://localhost:8787/
```

or with Compose:

```bash
docker compose up -d --build
```

On first start the entrypoint registers a WARP device and writes the config to
`/data/warp.json` (kept in the `warp-data` volume so it is reused on restart —
no credentials are baked into the image). The SOCKS proxy is bound to
`127.0.0.1` inside the container and is never published.

WARP prefers QUIC (HTTP/3) over UDP, which many hosts block. The entrypoint
detects a dead QUIC tunnel and automatically falls back to HTTP/2 over TCP+TLS,
so it works on hosts that drop UDP. Force a transport with
`WARP_TRANSPORT=http2` (or `http3`) to skip the probe.

| Env var | Default | Meaning |
|---------|---------|---------|
| `WARP_TRANSPORT` | `auto` | `auto` \| `http3` \| `http2` |
| `WARP_CONFIG` | `/data/warp.json` | where the WARP device config lives |

| Build arg | Default | Meaning |
|-----------|---------|---------|
| `USQUE_VERSION` | `4.2.1` | usque release to download (checksum-verified) |

### Deploying to Render / Railway / Fly

Works as a plain Docker service. Pick the **Docker** environment, and set:

- **Port:** `8787` (Render sets `PORT` itself — the server honours it).
- **Disk (optional):** mount at `/data` so the WARP registration is reused
  across deploys; without it a new device is registered on every boot.
- **Health check path:** `/health`.

Leave `WARP_TRANSPORT=auto` — it will use QUIC where allowed and TCP elsewhere.

## Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `PROXY` | *(empty = direct)* | SOCKS5 proxy, e.g. `socks5://127.0.0.1:40000` |
| `UPSTREAM_API_KEY` | built-in key | Upstream API key |
| `UPSTREAM_HOSTS` | built-in API host | Comma-separated hosts, tried in order |
| `UPSTREAM_CLIENT_NAME` | `VISIONOS` | Client name sent upstream |
| `UPSTREAM_CLIENT_VERSION` | `1.02` | Client version |
| `UPSTREAM_CLIENT_HEADER` | `101` | Client-name header value |
| `UPSTREAM_USER_AGENT` | Safari UA | User-Agent sent upstream |
| `MUSIC_HOST` | `https://music.youtube.com` | YouTube Music host |
| `MUSIC_API_KEY` | built-in key | YouTube Music API key |
| `MUSIC_CLIENT_NAME` | `WEB_REMIX` | Music client name |
| `MUSIC_CLIENT_VERSION` | `1.20261115.14.00` | Music client version |
| `MUSIC_CLIENT_HEADER` | `67` | Music client-name header |
| `MUSIC_USER_AGENT` | Chrome UA | User-Agent sent to the music host |
| `TIMEOUT_MS` | `30000` | Per-request timeout for API calls |
| `RETRIES` | `6` | Player-call retry count |

## Conventions

- Every JSON response carries `ok: true|false`. Failures also carry `error`.
- Upstream/parse failures return **502**; bad input returns **400**; a missing
  format returns **404**.
- Any `/api/*` route opened in a browser (i.e. `Accept: text/html`) **without**
  its required params shows the UI page instead of an error. Add `?json` to
  force JSON.
- `v` accepts a bare id or a full URL (`watch?v=`, short-link, `shorts/…`,
  `embed/…`, `live/…`). `url` and `id` are accepted as aliases for `v`.

## API reference

### `GET /` — browser UI

A single page that takes a keyword **or** a link/id:

- **Keyword** → search with **Videos / Channels / Playlists / All** filters and a
  **Load more** button. Clicking a video card loads its formats.
- **Link / id** → loads that video directly.

Each format row offers a **Direct URL** (with a Copy button), a **Download** link
(proxied) and an **Open** link.

`GET /?v=<id|url>` pre-loads a video.

---

### `GET /health`

```json
{
  "ok": true,
  "uptimeSeconds": 7,
  "client": "VISIONOS",
  "clientVersion": "1.02",
  "musicClient": "WEB_REMIX",
  "proxy": "socks5://127.0.0.1:40000",
  "host": "https://<upstream-host>"
}
```

---

### `GET /api/doc` — API reference

The full developer reference: every route this server exposes, grouped as Meta,
Video and Music, each with its parameters, a real example response and a ready
`curl` command. It also carries the response conventions, three worked recipes
(search → inspect → download; play a music track; browse an artist) and the
upstream-API catalogue.

Opened in a browser it renders a page. Every other client gets JSON. Add `?json`
to force JSON in a browser.

```bash
curl "http://localhost:8787/api/doc"
curl "http://localhost:8787/api/doc?json"
```

```json
{
  "ok": true,
  "name": "vidmate-yt-api",
  "base": "http://localhost:8787",
  "conventions": {
    "success": "Every JSON response carries \"ok\": true.",
    "failure": "\"ok\": false with an \"error\" string. Status 400 bad input, 404 no match, 502 upstream failure.",
    "auth": "No API key. The server holds the upstream keys; clients only need the base URL.",
    "network": "Raw directUrl links are bound to this server's egress IP, so stream through /api/download instead."
  },
  "recipes": [
    { "goal": "Search and download a video",
      "steps": ["GET /api/search?q=<query>&type=video → take results[0].videoId",
                "GET /api/info?v=<videoId> → pick a format by itag",
                "GET /api/download?v=<videoId>&itag=<itag> → stream the bytes"] }
  ],
  "count": 18,
  "routes": [
    { "path": "/api/info",
      "group": "Video",
      "summary": "Metadata and every format for one video, with direct and proxied links.",
      "params": [
        { "name": "v", "required": true, "description": "Video id or URL. Aliases: url, id." },
        { "name": "format", "required": false, "description": "video | audio | muxed." }
      ],
      "example": "/api/info?v=W0DM5lcj6mw&format=audio",
      "returns": "JSON",
      "response": { "ok": true, "count": 23, "video": { "videoId": "W0DM5lcj6mw" }, "formats": ["…"] },
      "notes": ["Use proxyUrl in clients; directUrl is bound to the server's egress IP."] }
  ],
  "apis": [ "…the same upstream catalogue as GET /api…" ]
}
```

Every JSON route in the payload carries a `response` sample, so a client can be
built straight from this endpoint without calling anything else first.

---

### `GET /api` — upstream API catalogue

Lists every upstream API the server calls, with the client, request shape, proxy
requirement and which routes use it. `GET /api/doc` serves the same list
alongside this server's own routes.

```json
{
  "ok": true,
  "videoClient": "VISIONOS 1.02",
  "musicClient": "WEB_REMIX 1.20261115.14.00",
  "count": 7,
  "apis": [
    { "id": "player", "method": "POST", "host": "https://youtubei.googleapis.com",
      "path": "/youtubei/v1/player", "client": "VISIONOS 1.02",
      "request": "videoId, contentCheckOk, racyCheckOk, context.client{visitorData}",
      "usedBy": ["/api/info", "/api/link", "/api/download", "/api/music/song"],
      "requiresProxy": true, "verified": true }
  ],
  "routes": ["GET /", "GET /api/music/search?q=&type=", "…"]
}
```

---

### YouTube Music — `GET /api/music/*`

Catalogue routes speak to `music.youtube.com` with the **WEB_REMIX** client.
Track ids come back as `videoId`; feed them to the video routes to stream.

| Route | Returns |
|---|---|
| `GET /api/music/search?q=&type=songs\|videos\|albums\|artists\|playlists` | `{ query, type, count, results[], continuation }` |
| `GET /api/music/home` | `{ count, shelves[] }` |
| `GET /api/music/artist?id=UC…` | `{ artist, topSongs[], albums[], singles[], videos[], related[], shelves[] }` |
| `GET /api/music/artist/songs?id=UC…` | `{ header, items[], continuation }` |
| `GET /api/music/album?id=MPREb…` | `{ header, items[], continuation }` |
| `GET /api/music/playlist?id=VL…\|PL…[&continuation=]` | `{ header, items[], continuation }` |
| `GET /api/music/song?id=<videoId>` | `{ song, expiresInSeconds, formatCount, links }` |
| `GET /api/music/lyrics?id=<videoId>` | `{ lyrics, browseId }` |
| `GET /api/music/trending` | `{ count, shelves[] }` |
| `GET /api/music/radio?id=<videoId>[&continuation=]` | `{ header, items[], continuation }` |

```bash
curl "http://localhost:8787/api/music/search?q=believer&type=songs"
curl "http://localhost:8787/api/music/artist?id=UCDxKh1gFWeYsqePvgVzmPoQ" | jq '.topSongs'
curl "http://localhost:8787/api/music/trending" | jq '.shelves[].title'
```

Full request/response reference: [`docs/API.md`](docs/API.md).

---

### `GET /api/search?q=<query>[&type=video|channel|playlist|all][&continuation=<token>]`

Keyword search. `type` defaults to `video`. Pass the `continuation` token from a
previous response to fetch the next page; the server only follows real
next-page tokens, so pages never repeat. `query` and `search` are accepted as
aliases for `q`.

```bash
curl "http://localhost:8787/api/search?q=bangla+song"
curl "http://localhost:8787/api/search?q=tahsan&type=channel"
```

```json
{
  "ok": true,
  "query": "bangla song",
  "type": "video",
  "count": 20,
  "continuation": "EpsDEgZ0YWhzYW4...",
  "results": [
    {
      "kind": "video",
      "videoId": "iss_85SWLYA",
      "title": "Prem Tumi | প্রেম তুমি | Tahsan | Tisha | ...",
      "channel": "CD Choice",
      "channelId": "UC...",
      "lengthSeconds": 350,
      "lengthText": "5:51",
      "viewCount": 25000000,
      "viewCountText": "25M views",
      "publishedTimeText": "7 years ago",
      "thumbnail": "https://<img-cdn>/vi/iss_85SWLYA/hq720.jpg",
      "url": "https://<upstream>/watch?v=iss_85SWLYA",
      "infoUrl": "http://localhost:8787/api/info?v=iss_85SWLYA",
      "downloadUrl": "http://localhost:8787/api/link?v=iss_85SWLYA",
      "audioUrl": "http://localhost:8787/api/link?v=iss_85SWLYA&format=audio",
      "linkUrl": "http://localhost:8787/api/link?v=iss_85SWLYA"
    }
  ]
}
```

Channel results:

```json
{
  "kind": "channel",
  "channelId": "UCh2a1Cd6nKoNkKg2rEgDdpw",
  "title": "Tahsan",
  "handle": "@tahsantv",
  "subscriberCountText": "744K subscribers",
  "thumbnail": "https://<img-cdn>/...",
  "url": "https://<upstream>/channel/UCh2a1Cd6nKoNkKg2rEgDdpw"
}
```

Playlist results:

```json
{
  "kind": "playlist",
  "playlistId": "PLRSi3ZrLmUDXPlFmt6rxo_X9sRUlB83ml",
  "title": "Most Popular Bengali Folk Songs",
  "channel": "Times Music Bangla",
  "videoCountText": "99 videos",
  "thumbnail": "https://<img-cdn>/...",
  "url": "https://<upstream>/playlist?list=PLRSi3ZrLmUDXPlFmt6rxo_X9sRUlB83ml"
}
```

`continuation` is `null` when there is no further page.

---

### `GET /api/info?v=<id|url>[&format=video|audio|muxed][&maxHeight=1080]`

Video metadata plus every available format. `format` and `maxHeight` filter the
returned list. Each format carries a `directUrl` (upstream, short-lived) and a
`proxyUrl` (through this server).

```bash
curl "http://localhost:8787/api/info?v=64f_JnZuJPo"
curl "http://localhost:8787/api/info?v=64f_JnZuJPo&format=audio"
curl "http://localhost:8787/api/info?v=64f_JnZuJPo&maxHeight=720"
```

```json
{
  "ok": true,
  "video": {
    "videoId": "64f_JnZuJPo",
    "title": "…",
    "author": "…",
    "lengthSeconds": 212,
    "viewCount": 1234567
  },
  "hlsManifestUrl": null,
  "dashManifestUrl": null,
  "expiresInSeconds": 21540,
  "count": 23,
  "formats": [
    {
      "itag": 137,
      "kind": "video",
      "quality": "1080p",
      "container": "mp4",
      "codec": "avc1.640028",
      "bitrate": 4333000,
      "contentLength": 98600000,
      "fps": 25,
      "width": 1920,
      "height": 1080,
      "directUrl": "https://<cdn-host>/videoplayback?...",
      "proxyUrl": "http://localhost:8787/api/download?v=64f_JnZuJPo&itag=137"
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `kind` | `video`, `audio` or `muxed` (video+audio in one track) |
| `expiresInSeconds` | How long the `directUrl` links stay valid |
| `contentLength` | Exact byte size of the track |

---

### `GET /api/link?v=<id|url>[&itag=][&quality=best|1080|720|360|worst][&format=video|audio|any]`

One best-matching link (plus the paired audio track when the chosen video is not
already muxed). `format` defaults to `video`. If `format=muxed` is requested but
no muxed track exists, it falls back to the best video track.

```bash
curl "http://localhost:8787/api/link?v=64f_JnZuJPo&quality=720"
curl "http://localhost:8787/api/link?v=64f_JnZuJPo&format=audio"
```

```json
{
  "ok": true,
  "video": { "videoId": "64f_JnZuJPo", "title": "…", "author": "…", "lengthSeconds": 212 },
  "expiresInSeconds": 21540,
  "selected": {
    "video": { "itag": 136, "kind": "video", "quality": "720p", "container": "mp4" },
    "audio": { "itag": 140, "kind": "audio", "container": "mp4", "codec": "mp4a.40.2" }
  },
  "downloadUrl": "http://localhost:8787/api/download?v=64f_JnZuJPo&itag=136",
  "directUrl": "https://<cdn-host>/videoplayback?...",
  "audioUrl": "http://localhost:8787/api/download?v=64f_JnZuJPo&itag=140",
  "audioDirectUrl": "https://<cdn-host>/videoplayback?..."
}
```

---

### `GET /api/download?v=<id|url>&itag=<itag>[&dl=1]`

Streams one track through the server. Supports `Range` (seeking), `HEAD`, and
`?dl=1` to force an attachment filename. Internally the media is paged in 4 MiB
chunks, because a single long-lived request stalls after ~8-12 MiB.

```bash
# full file
curl -L -o out.mp4 "http://localhost:8787/api/download?v=64f_JnZuJPo&itag=134&dl=1"

# seek (bytes 40,000,000 onward)
curl -H "Range: bytes=40000000-" -o tail.bin \
  "http://localhost:8787/api/download?v=64f_JnZuJPo&itag=134"
```

Response headers: `Accept-Ranges: bytes`, `Content-Type` from the track,
`Content-Length`, and `Content-Range` + **206** for ranged requests.

---


### Unknown routes

`GET /nope` → `404`

```json
{
  "ok": false,
  "error": "not found",
  "routes": [
    "GET /",
    "GET /health",
    "GET /api",
    "GET /api/doc",
    "GET /api/search?q=",
    "GET /api/info?v=",
    "GET /api/link?v=",
    "GET /api/download?v=&itag=",
    "GET /api/music/search?q=&type=",
    "GET /api/music/home",
    "GET /api/music/artist?id=",
    "GET /api/music/artist/songs?id=",
    "GET /api/music/album?id=",
    "GET /api/music/playlist?id=",
    "GET /api/music/song?id=",
    "GET /api/music/lyrics?id=",
    "GET /api/music/trending",
    "GET /api/music/radio?id="
  ]
}
```

## End-to-end example

```bash
BASE=http://localhost:8787

# 1. search
curl -s "$BASE/api/search?q=bangla+song&type=video" | jq '.results[0].videoId'

# 2. inspect formats
curl -s "$BASE/api/info?v=iss_85SWLYA" | jq '.formats[] | {itag,kind,quality,contentLength}'

# 3. grab audio only
curl -L -o song.m4a "$BASE/api/link?v=iss_85SWLYA&format=audio" -o song.m4a 2>/dev/null
```

## How it works

1. `POST …/visitor_id` → `visitorData`.
2. `POST …/player` with the configured client + `visitorData`. Most clients
   return only a ~5% "preview" of each media URL on flagged IPs; the Vidmate
   client returns the whole file.
3. Each `adaptiveFormats[]` entry's signed `url` is exposed as `directUrl`.
4. `GET /api/download` pages that URL in 4 MiB `Range` requests, following the
   CDN's 302 load-balancer redirects, and writes the bytes to the client.

## Tests

An end-to-end suite boots the built server and drives it over HTTP — no mocks.
It needs network egress to the upstream API; on a datacenter host point `PROXY`
at a SOCKS5 proxy (e.g. WARP).

```bash
npm test                          # full suite
PROXY=socks5://127.0.0.1:40000 npm test
```

Two suites boot the built server and drive it over HTTP — no mocks:
`test/api.test.mjs` covers the video API, and `test/music.test.mjs` covers the
YouTube Music catalogue, the `/api` catalogue and the `/api/doc` reference.
Together: `/health`, search (all four types, paging without repeats, bad input),
`/api/info` (link fields + filters), `/api/link` (video/audio/muxed fallback),
`/api/download` (`HEAD`, `Range`, 400/404), `/api` + `/api/doc` and every
`/api/music/*` route.

## Notes & limits

- Media URLs expire (`expiresInSeconds` in `/api/info`); `/api/download`
  re-mints on each request, so links handed out by `/api/link` are
  short-lived.
- The 4 MiB chunk size is deliberate; larger single ranges stall.
- For personal/research use. Respect the upstream platform's terms of service
  and copyright.
