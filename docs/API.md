# API reference

Base URL: `http://<host>:8787` (override with `PORT` / `HOST`).

Every JSON response carries `ok: true|false`; failures also carry `error`.
Status codes: **400** bad input, **404** nothing matched, **502** upstream or
parse failure. Any `/api/*` route opened in a browser (`Accept: text/html`)
without its required params shows the UI page — add `?json` to force JSON.

`v` / `id` accepts a bare id or a full URL (`watch?v=`, `youtu.be/…`,
`shorts/…`, `embed/…`, `live/…`, YouTube Music `browse/…`).

> **Proxy required.** On a datacenter IP the upstream blocks anonymous
> catalogue and media access. Run with `PROXY=socks5://127.0.0.1:40000`
> (Cloudflare WARP via `usque`, included in the Docker image). See
> [README → Run with Docker](../README.md#run-with-docker-warp-included).

---

## Video API

### `GET /` — browser UI
Single page: a keyword searches (Videos / Channels / Playlists / All) and a
link/id loads that video's formats. `GET /?v=<id|url>` pre-loads a video.

### `GET /health`
```json
{ "ok": true, "uptimeSeconds": 7, "client": "VISIONOS",
  "clientVersion": "1.02", "musicClient": "WEB_REMIX", "proxy": "socks5://…", "host": "https://youtubei.googleapis.com" }
```

### `GET /api`
Catalogue of every upstream API this server calls (id, host, path, client,
request shape, `requiresProxy`, `usedBy`, `verified`), plus the route list.
```json
{ "ok": true, "count": 7, "apis": [ { "id": "player", "host": "https://youtubei.googleapis.com",
  "path": "/youtubei/v1/player", "client": "VISIONOS 1.02", "requiresProxy": true,
  "usedBy": ["/api/info", "…"], "verified": true } ], "routes": ["GET /", "…"] }
```

### `GET /api/search?q=<query>[&type=video|channel|playlist|all][&continuation=<token>]`
Keyword search. `type` defaults to `video`. Pass the returned `continuation` to
page. Each video result carries `url`, `infoUrl`, `downloadUrl`, `audioUrl`,
`linkUrl`.

### `GET /api/info?v=<id|url>[&format=video|audio|muxed][&maxHeight=1080]`
Metadata plus every format with `directUrl` and `proxyUrl`. Without `v` it
returns the `/api` catalogue.

### `GET /api/link?v=<id|url>[&itag=][&quality=best|1080|720|360|worst][&format=video|audio|muxed|any]`
A single best-matching `downloadUrl` plus the paired audio link.

### `GET /api/download?v=<id|url>&itag=<itag>[&dl=1]`
Streams the media through the server with `Range`/`HEAD` support. `dl=1` sets a
`Content-Disposition` attachment filename.

## YouTube Music API — `/api/music/*`

Catalogue routes speak to `music.youtube.com` with the **WEB_REMIX** client.
Track ids come back as `videoId`; feed them to the video routes (`/api/info`,
`/api/link`, `/api/download`) to stream. Every response includes
`client`, `clientVersion`, `host` for the music client.

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
| `GET /api/music/trending` | `{ count, shelves[] }` (charts + explore) |
| `GET /api/music/radio?id=<videoId>[&continuation=]` | `{ header, items[], continuation }` |

An **item** is `{ kind, title, subtitle?, videoId?, browseId?, playlistId?,
duration?, durationSeconds?, year?, plays?, thumbnail? }` where `kind` is one of
`song|video|album|artist|playlist|podcast|episode`.

Examples:
```bash
BASE=http://localhost:8787

curl -s "$BASE/api/music/search?q=believer&type=songs"   | jq '.results[0]'
curl -s "$BASE/api/music/artist?id=UCDxKh1gFWeYsqePvgVzmPoQ" | jq '.topSongs'
curl -s "$BASE/api/music/playlist?id=PL2WAE39ngDYNsU2pAE6Vv6Cwlp_Sjp_lc" | jq '.items | length'

# track id -> audio stream
VID=$(curl -s "$BASE/api/music/search?q=believer&type=songs" | jq -r '.results[0].videoId')
curl -L -o song.m4a "$BASE/api/link?v=$VID&format=audio"
```

Notes:
- `playlist`/`album` track ids live at `playlistItemData.videoId` upstream.
- Artist **"Top songs" is a `musicShelfRenderer`** (not a carousel); "More" is
  `MPAD<channelId>`.
- Continuation tokens are per-surface — pass the token back to the *same* route.
- Music-catalogue songs and albums only resolve through a proxy; without one the
  filters return "No results".

---

## Unknown routes
`GET /nope` → `404` with `{ ok: false, error: "not found", routes: [...] }`.
