# Deployed API reference — `https://xro-yt-api.onrender.com`

Everything below was verified by calling the live deployment, not read from
source. Response shapes are copied from real responses.

> **Important — the live deployment runs an older build.**
> It still exposes `/api/merge` and has no `/api/music/*` routes and no
> `GET /api`. The current `main` branch (commit `500dcb4`) removes `/api/merge`
> and adds the whole music surface. Push and redeploy to make the two match.
> See [Local build](#local-build-newer) at the end.

Base URL: `https://xro-yt-api.onrender.com`

All responses are JSON unless the endpoint streams a media file. Every JSON
response carries `"ok": true` on success and `"ok": false` with an `error`
string on failure.

Free-tier note: the instance sleeps after 15 minutes idle, so the first request
after a quiet period waits roughly a minute for a cold start.

---

## Route index

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | HTML landing page (browser only) |
| GET | `/health` | Liveness and current client/proxy config |
| GET | `/api/search` | YouTube search — videos, channels, playlists |
| GET | `/api/info` | Full metadata and every format for one video |
| GET | `/api/link` | Pick one playable format and return its URLs |
| GET | `/api/download` | Stream the media bytes (Range supported) |
| GET | `/api/merge` | **Deprecated** — server-side ffmpeg mux |
| GET | `/api/music/*` | **Not deployed** — see the local build section |

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
  "proxy": "socks5://127.0.0.1:40000",
  "host": "https://youtubei.googleapis.com"
}
```

`proxy` is the WARP SOCKS5 endpoint. The server reaches YouTube through it
because a datacenter IP is blocked by `googlevideo`.

---

## `GET /api/search`

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `q` | yes | — | Query text. Aliases: `query`, `search`. |
| `type` | no | `video` | One of `video`, `channel`, `playlist`, `all`. |
| `continuation` | no | — | Token from a previous response, for the next page. |

Example: `/api/search?q=believer&type=video`

```json
{
  "ok": true,
  "query": "believer",
  "type": "video",
  "count": 20,
  "continuation": "EqADEgt...",
  "results": [
    {
      "videoId": "W0DM5lcj6mw",
      "title": "Imagine Dragons - Believer (Lyrics)",
      "kind": "video",
      "channel": "7clouds",
      "channelId": "UC...",
      "lengthSeconds": 204,
      "lengthText": "3:24",
      "viewCount": 1234567,
      "viewCountText": "1.2M views",
      "publishedTimeText": "7 years ago",
      "thumbnail": "https://...",
      "url": "https://www.youtube.com/watch?v=W0DM5lcj6mw",
      "infoUrl": "https://xro-yt-api.onrender.com/api/info?v=W0DM5lcj6mw",
      "linkUrl": "https://xro-yt-api.onrender.com/api/link?v=W0DM5lcj6mw",
      "downloadUrl": "https://xro-yt-api.onrender.com/api/merge?v=W0DM5lcj6mw",
      "audioUrl": "https://xro-yt-api.onrender.com/api/link?v=W0DM5lcj6mw&format=audio"
    }
  ]
}
```

Result keys: `audioUrl`, `channel`, `channelId`, `downloadUrl`, `infoUrl`,
`kind`, `lengthSeconds`, `lengthText`, `linkUrl`, `publishedTimeText`,
`thumbnail`, `title`, `url`, `videoId`, `viewCount`, `viewCountText`.

Pass `continuation` back as a query param to page through results.

---

## `GET /api/info`

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `v` | yes | — | Video id or full URL. Aliases: `url`, `id`. |
| `format` | no | all | `video`, `audio`, or `muxed` — filters `formats`. |
| `maxHeight` | no | — | Drop video formats taller than this, e.g. `720`. |

Example: `/api/info?v=W0DM5lcj6mw`

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
      "proxyUrl": "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=248",
      "mergeUrl": "https://xro-yt-api.onrender.com/api/merge?v=W0DM5lcj6mw"
    }
  ]
}
```

Format keys: `bitrate`, `codec`, `container`, `contentLength`, `directUrl`,
`fps`, `height`, `itag`, `kind`, `mergeUrl`, `proxyUrl`, `quality`, `width`.
`kind` is `video` or `audio`. `directUrl` expires — use `proxyUrl` for links
that must keep working.

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

Example: `/api/link?v=W0DM5lcj6mw&format=audio`

```json
{
  "ok": true,
  "expiresInSeconds": 21540,
  "video": { "videoId": "W0DM5lcj6mw", "title": "Imagine Dragons - Believer (Lyrics)", "author": "7clouds", "lengthSeconds": 204 },
  "selected": {
    "video": { "itag": 251, "kind": "audio", "quality": "AUDIO_QUALITY_MEDIUM", "container": "webm" },
    "audio": { "itag": 251, "kind": "audio", "quality": "AUDIO_QUALITY_MEDIUM", "container": "webm" }
  },
  "directUrl": "https://...googlevideo.com/...",
  "audioDirectUrl": "https://...",
  "downloadUrl": "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=251",
  "audioUrl": "https://xro-yt-api.onrender.com/api/download?v=W0DM5lcj6mw&itag=251",
  "mergeUrl": "https://xro-yt-api.onrender.com/api/merge?v=W0DM5lcj6mw"
}
```

Top-level keys: `audioDirectUrl`, `audioUrl`, `directUrl`, `downloadUrl`,
`expiresInSeconds`, `mergeUrl`, `ok`, `selected`, `video`.

---

## `GET /api/download`

Streams the media bytes. This is the endpoint `proxyUrl` and `audioUrl` point
at, and the only one that returns a file rather than JSON.

| Param | Required | Default | Notes |
| --- | --- | --- | --- |
| `v` | yes | — | Video id or URL. Aliases: `url`, `id`. |
| `itag` | yes | — | Format to stream, from `/api/info`. |
| `dl` | no | — | Present at all → send `Content-Disposition: attachment`. |

Example: `/api/download?v=W0DM5lcj6mw&itag=140`

Sends `Range` through to `googlevideo`, so audio and video players can seek.
Pass a `Range` request header to get a partial response.

---

## `GET /api/merge` — deprecated

| Param | Required | Notes |
| --- | --- | --- |
| `v` | yes | Video id or URL. |

Muxes the best video track with a matching audio track using ffmpeg and streams
the result. It buffers heavily and dominates the server's memory, which is why
it is removed on `main`. Do not build against it.

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
  "routes": ["GET /", "GET /health", "GET /api/search?q=", "GET /api/info?v=", "GET /api/link?v=", "GET /api/download?v=&itag=", "GET /api/merge?v="]
}
```

Status codes: `400` bad or missing params, `404` unknown route or unavailable
itag, `502` upstream failure.

---

## Local build (newer)

`main` at commit `500dcb4` differs from what is deployed:

| Change | Effect |
| --- | --- |
| `/api/merge` deleted | Route is gone; `mergeUrl` is dropped from every payload. |
| `GET /api` added | Returns the upstream-API catalogue as JSON. |
| `/api/music/*` added | Ten YouTube Music routes, listed below. |

Music routes (all under `/api/music`, none currently reachable online):

| Path | Params |
| --- | --- |
| `/search` | `q` (aliases `query`), `type` = `songs` (default), `videos`, `albums`, `artists`, `playlists`; `continuation` |
| `/home` | none |
| `/artist` | `id` (alias `channelId`) |
| `/artist/songs` | `id` (alias `channelId`) |
| `/album` | `id` (alias `browseId`) |
| `/playlist` | `id` (alias `list`); `continuation` |
| `/trending` | none |
| `/radio` | `id` (alias `v`); `continuation` |
| `/song` | `id` (alias `v`) |
| `/lyrics` | `id` (alias `v`) |

On `main`, `/api/search` results point `downloadUrl` at `/api/link` instead of
the deleted `/api/merge`.
