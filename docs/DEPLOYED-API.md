# Deployed API reference — `https://xro-yt-api.onrender.com`

Everything below was verified by calling the live deployment, not read from
source. Response shapes are copied from real responses.

Base URL: `https://xro-yt-api.onrender.com`

All responses are JSON unless the endpoint streams a media file. Every JSON
response carries `"ok": true` on success and `"ok": false` with an `error`
string on failure.

Free-tier note: the instance sleeps after 15 minutes idle, so the first request
after a quiet period waits roughly a minute for a cold start.

> **Route move.** The API reference lives at `/api/doc`. Video metadata stays on
> `/api/info?v=`, where it always was. Until this branch is deployed, `/api/doc`
> is a 404 on the live host.

---

## Route index

| Method | Path | Purpose | On the live host |
| --- | --- | --- | --- |
| GET | `/` | HTML landing page (browser only) | yes |
| GET | `/health` | Liveness and current client/proxy config | yes |
| GET | `/api` | Upstream-API catalogue (JSON) | yes |
| GET | `/api/info` | Video metadata and every format | yes |
| GET | `/api/search` | YouTube search — videos, channels, playlists | yes |
| GET | `/api/doc` | API reference (page or JSON) | 404 |
| GET | `/api/link` | Pick one playable format and return its URLs | yes |
| GET | `/api/download` | Stream the media bytes (Range supported) | yes |
| GET | `/api/music/*` | Ten YouTube Music routes | yes |

`/api/merge` is gone; it was removed before this deployment.

---

## `GET /health`

No parameters. Returns uptime and the upstream configuration the server booted
with.

```json
{
  "ok": true,
  "uptimeSeconds": 291,
  "client": "VISIONOS",
  "clientVersion": "1.02",
  "musicClient": "WEB_REMIX",
  "proxy": "socks5://127.0.0.1:40000",
  "host": "https://youtubei.googleapis.com"
}
```

`proxy` is the WARP SOCKS5 endpoint. The server reaches YouTube through it
because a datacenter IP is blocked by `googlevideo`.

---

## `GET /api/doc`

The API reference. Lists every route with its params, a real sample response and
a `curl` line, plus the response conventions, worked recipes and the upstream
catalogue. Browsers get a page; other clients get JSON. `?json` forces JSON in a
browser.

---

## `GET /api/info`

Video metadata and every format. Live on the host today; unchanged by this
branch.

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `v` | yes | — | Video id or full URL. Aliases: `url`, `id`. |
| `format` | no | all | `video`, `audio`, or `muxed` — filters `formats`. |
| `maxHeight` | no | — | Drop video formats taller than this, e.g. `720`. |

```json
{
  "ok": true,
  "count": 23,
  "expiresInSeconds": 21540,
  "hlsManifestUrl": "https://manifest.googlevideo.com/...",
  "video": {
    "videoId": "W0DM5lcj6mw",
    "title": "Imagine Dragons - Believer (Lyrics)",
    "author": "7clouds",
    "lengthSeconds": 204,
    "viewCount": 1234567
  },
  "formats": [
    {
      "itag": 248,
      "kind": "video",
      "quality": "1080p",
      "container": "webm",
      "codec": "vp9",
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "bitrate": 1426245,
      "contentLength": "54123456",
      "directUrl": "https://...googlevideo.com/...",
      "proxyUrl": "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=248"
    }
  ]
}
```

Format keys: `bitrate`, `codec`, `container`, `contentLength`, `directUrl`,
`fps`, `height`, `itag`, `kind`, `proxyUrl`, `quality`, `width`. `kind` is
`video` or `audio`. `directUrl` expires — use `proxyUrl` for links that must
keep working. `mergeUrl` no longer exists.

---

## `GET /api/search`

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `q` | yes | — | Query text. Aliases: `query`, `search`. |
| `type` | no | `video` | One of `video`, `channel`, `playlist`, `all`. |
| `continuation` | no | — | Token from a previous response, for the next page. |

Example: `/api/search?q=believer&type=video` returns 20 results, each with
`videoId`, `title`, `kind`, `channel`, `channelId`, `lengthSeconds`,
`lengthText`, `viewCount`, `viewCountText`, `publishedTimeText`, `thumbnail`,
`url`, `infoUrl`, `linkUrl`, `downloadUrl` and `audioUrl`. Pass `continuation`
back to page through results.

---

## `GET /api/link`

Resolves one format and returns ready-to-use URLs. Prefer this over
`/api/info` when the caller just wants something playable.

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `v` | yes | — | Video id or URL. Aliases: `url`, `id`. |
| `format` | no | `video` | `video`, `audio`, or `muxed`. |
| `quality` | no | `best` | `best`, `worst`, or a height such as `720`. |
| `itag` | no | — | Pin an exact format by itag. |

Top-level keys: `audioDirectUrl`, `audioUrl`, `directUrl`, `downloadUrl`,
`expiresInSeconds`, `ok`, `selected`, `video`.

---

## `GET /api/download`

Streams the media bytes. This is the endpoint `proxyUrl` and `audioUrl` point
at, and the only one that returns a file rather than JSON.

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `v` | yes | — | Video id or URL. Aliases: `url`, `id`. |
| `itag` | yes | — | Format to stream, from `/api/info`. |
| `dl` | no | — | Present at all sends `Content-Disposition: attachment`. |

Example: `/api/download?v=W0DM5lcj6mw&itag=140`. Range requests answer `206`.
The `dl=1` form sets a filename such as
`Imagine Dragons - Believer _Lyrics__AUDIO_QUALITY_MEDIUM_140.mp4`.

---

## `GET /api/music/*`

Ten routes, all live. See the [README](../README.md) for the full parameter list.

| Path | Params |
| --- | --- |
| `/search` | `q` (alias `query`), `type` = `songs` (default), `videos`, `albums`, `artists`, `playlists`; `continuation` |
| `/home` | none |
| `/artist` | `id` (alias `channelId`) |
| `/artist/songs` | `id` (alias `channelId`) |
| `/album` | `id` (alias `browseId`) |
| `/playlist` | `id` (alias `list`); `continuation` |
| `/trending` | none |
| `/radio` | `id` (alias `v`); `continuation` |
| `/song` | `id` (alias `v`) |
| `/lyrics` | `id` (alias `v`) |

---

## Error shape

```json
{ "ok": false, "error": "missing query param: v (video id or URL)" }
```

Unknown routes return the route list:

```json
{
  "ok": false,
  "error": "not found",
  "routes": ["GET /", "GET /health", "GET /api", "GET /api/doc", "GET /api/search?q=", "GET /api/info?v=", "GET /api/link?v=", "GET /api/download?v=&itag="]
}
```

Status codes: `400` bad or missing params, `404` unknown route or unavailable
itag, `502` upstream failure.
