# AGENTS.md

## Project

`xro-yt` ("Xro-YT Unofficial Music API", package name `vidmate-yt-api`) — a
Node.js + TypeScript Express server that exposes YouTube InnerTube media
(search, formats, proxied download) **and** the YouTube Music catalogue over
HTTP. Upstream calls use the **VISIONOS** InnerTube client for
media (key recovered from the Vidmate APK, because most other clients return only
a ~5% media preview on flagged/datacenter IPs) and **WEB_REMIX** for the music
catalogue.

## Layout

- `src/index.ts` — routes `/`, `/health`, `/api` (catalogue), `/api/info`
  (API reference), `/api/search`, `/api/video`, `/api/link`, `/api/download`;
  mounts `/api/music`.
- `src/music-routes.ts` — `/api/music/*` HTTP layer.
- `src/music.ts` — YouTube Music client (WEB_REMIX): browse/search/next + parsers.
- `src/innertube.ts` — video client (VISIONOS): search + player.
- `src/catalog.ts` — `GET /api` upstream-API catalogue; keep in sync with the
  clients.
- `src/docs.ts` — `GET /api/info` reference: route list + upstream catalogue,
  rendered as a page or JSON.
- `src/config.ts` — two clients: `client` (VISIONOS, media) and `music`
  (WEB_REMIX, catalogue), both env-overridable.
- `docs/API.md` — full route reference.

## Commands

- `npm run build` — `tsc -p tsconfig.json` (emits `dist/`)
- `npm start` — `node dist/index.js` (default port 8787)
- `npm test` — builds, then `node --test "test/**/*.test.mjs"` (real HTTP, no mocks)
- `npm run typecheck` — `tsc --noEmit`

Tests need network egress. On a datacenter host set `PROXY` (SOCKS5) or the
signed googlevideo URLs 403.

## Architecture

- `src/config.ts` — env-driven config (video client, music client, hosts, key, proxy, timeouts).
- `src/http.ts` — `requestJson` fetch wrapper (proxy + timeout aware).
- `src/innertube.ts` — video search + player (`getVideoInfo`), format parsing,
  `parseVideoId`.
- `src/music.ts` — YouTube Music catalogue (WEB_REMIX browse/search/next + parsers).
- `src/music-routes.ts` — `/api/music/*` handlers.
- `src/catalog.ts` — `GET /api` upstream-API catalogue.
- `src/docs.ts` — `GET /api/info` API reference (page + JSON).
- `src/stream.ts` — 4 MiB Range-chunked proxying of a signed media URL.
- `src/home.ts` — HTML UI served at `/`.
- `src/index.ts` — Express routes and error handling.

Routes: `GET /`, `/health`, `/api`, `/api/info`, `/api/search?q=&type=&continuation=`,
`/api/video?v=&format=&maxHeight=`, `/api/link?v=&itag=&quality=&format=`,
`/api/download?v=&itag=&dl=1`, and
`/api/music/{search,home,artist,artist/songs,album,playlist,song,lyrics,trending,radio}`.

## Conventions

- Every JSON response carries `ok: true|false`; failures also carry `error`.
- 502 upstream/parse failures, 400 bad input, 404 missing format.
- `/api/info` renders a page in a browser and JSON elsewhere; `?json` forces
  JSON. Other `/api/*` routes answer JSON, or the UI for browsers when required
  params are missing.
- `v` accepts a bare id or URL (`watch?v=`, `youtu.be`, `shorts/`, `embed/`,
  `live/`). `url` / `id` are aliases.

## Upstream notes (verified 2026-11)

- **Working client = VISIONOS** (`clientName=VISIONOS`, `clientVersion=1.02`,
  `X-Youtube-Client-Name: 101`, Safari UA, `deviceModel: RealityDevice17,1`).
  Mint `visitorData` via `POST /youtubei/v1/visitor_id` **and** send it in both
  the context and the `X-Goog-Visitor-Id` header — without the visitor id the
  player returns `LOGIN_REQUIRED` ("Sign in to confirm you're not a bot").
  Host `youtubei.googleapis.com`; the YTM key also works here.
- **Most "anonymous" failures are really the datacenter IP.** Direct from this
  host, YTM catalog "song" ids (e.g. `7UmMidoCer0`) return `UNPLAYABLE` /
  "This video is not available" from every client (VISIONOS, WEB_REMIX,
  ANDROID_VR, IOS, TVHTML5, MWEB) and ANDROID_MUSIC returns `LOGIN_REQUIRED`;
  the YTM **songs** and **albums** search filters return "No results"; the home
  page shows only a "Podcasts to get you started" shelf. Route the same requests
  through the WARP SOCKS proxy (below) and all three behave normally: songs and
  albums filters return 20 rows each, catalog songs stream (`OK`, 5 audio
  formats), and home returns real shelves (Song mixes, Trending community
  playlists). So these are **IP/egress gating, not server-side degradation or
  param bugs** — do not "fix" them in code, fix the egress.
- **YTM search type filters**: params = `EgWKAQ` + type byte + suffix. Type
  bytes (from ytmusicapi): songs `II`, videos `IQ`, albums `IY`, artists `Ig`,
  playlists `Io`, profiles `JY`, podcasts `JQ`, episodes `JI`; suffix
  `AWoMEA4QChADEAQQCRAF`.
- **Albums**: an artist page exposes album ids as `MPREb…`; browse one directly
  (`browseId: "MPREb…"`) for the track list. Album/playlist track ids live at
  `playlistItemData.videoId`.
- **Artist page shape**: `musicImmersiveHeaderRenderer` (name, subscribers) plus
  carousel shelves Albums / Singles & EPs / Videos / Live performances /
  Featured on / Playlists by <artist> / Fans might also like. **"Top songs" is a
  plain `musicShelfRenderer`, not a carousel** — grep it by title, then read its
  `musicResponsiveListItemRenderer` rows (each row's third column carries the
  play count, e.g. "99M plays"). The shelf's "More" browse id is `MPAD<channelId>`
  (album grids, `musicTwoRowItemRenderer`).
- **Trending**: `FEmusic_explore` has a "Trending" carousel; `FEmusic_charts`
  carries the real chart rows (Video charts / Genres / Top albums / Top artists,
  ~140 `musicResponsiveListItemRenderer`).
- **WARP egress (dev)**: `usque` v4.2.1 (see `Dockerfile`) exposes Cloudflare
  WARP as a SOCKS5 proxy. To reproduce locally:
  `usque --config /tmp/warp.json register --accept-tos` then
  `usque --config /tmp/warp.json socks --bind 127.0.0.1 --port 40000
  --always-reconnect`, and run everything with `PROXY=socks5://127.0.0.1:40000`.
  Confirm egress with `curl --socks5-hostname 127.0.0.1:40000
  https://api.cloudflare.com/cdn-cgi/trace` (`warp=on`, `ip=` is the WARP IP
  that the signed googlevideo URL's `ip=` param must match). With WARP the full
  suite passes: `PROXY=… npm test`.
- **Playlist rows**: YTM uses `musicResponsiveListItemRenderer` and the video id
  lives at `playlistItemData.videoId` (there is **no** `watchEndpoint` on the
  row). youtube.com (WEB) playlists now use `lockupViewModel` with `contentId`
  as the video id — `playlistVideoRenderer` is empty.
- **Lyrics**: `next` exposes a "Lyrics" tab; its `browseEndpoint.browseId`
  (e.g. `MPLYt_...`) browsed back returns text in
  `musicDescriptionShelfRenderer.description`.
- **JS bundles**: `youtube.player.web_20261115_00_RC00`, `signatureTimestamp`
  20770, identical base.js for youtube.com and music.youtube.com
  (md5 `1fb4b04bcd85d70e15e02fe29100c78b`). `signatureCipher` appears only in a
  string table; no classic `split("")`-reverse decipher function is present
  (string-table indirection). The `n` param is handled by `DMa`, which reads
  `.get("n")` and rewrites `/n/<token>` in the URL. For the VISIONOS client the
  media URLs come back direct (no cipher), so no deciphering is needed.
