# Xro-YT — Implementation plan: YouTube Music endpoints + `/api` catalog + docs

Status: **plan** (nothing implemented yet). Grounded in the current `src/` and in
the module verification done through the WARP SOCKS proxy (`PROXY=socks5://127.0.0.1:40000`).

## 1. What exists today

| Route | Source | Client |
|---|---|---|
| `GET /` | `src/home.ts` | — |
| `GET /health` | `src/index.ts` | — |
| `GET /api/search` | `src/innertube.ts` `searchYouTube()` | VISIONOS |
| `GET /api/info` | `src/innertube.ts` `getVideoInfo()` | VISIONOS |
| `GET /api/link` | `src/index.ts` | VISIONOS |
| `GET /api/download` | `src/stream.ts` | — |

Everything speaks **one** InnerTube client (`VISIONOS`) against
`youtubei.googleapis.com`. There is no YouTube Music surface, and no machine-
readable list of the upstream APIs the server uses.

## 2. Verified module results (through WARP)

All checks below were run with `node -e` through the usque WARP SOCKS proxy.
Direct (datacenter IP) these same calls fail; WARP is a hard requirement.

| Module | Call | Verified result |
|---|---|---|
| M1 Search (video) | `youtubei/v1/search` (VISIONOS) | 20 items |
| M2 YTM search filters | `music.youtube.com/youtubei/v1/search` (WEB_REMIX) | songs=20 videos=20 albums=20 artists=5 playlists=20 |
| M3 Music home | `browse FEmusic_home` | shelves: Song mixes, Trending community playlists |
| M4 Song metadata | `player` (VISIONOS) | title/author/views ok |
| M5 Artist | `browse UC…` | immersive header + shelves; **"Top songs" is a `musicShelfRenderer`**, "More" id = `MPAD<channelId>` |
| M6 Album | `browse MPREb…` | track list via `playlistItemData.videoId` |
| M7 Playlist | `browse VL…` | 23 tracks |
| M8 Music streaming | `player` (VISIONOS) | music-track ids now `OK`, 5 audio formats |
| M9 Lyrics | `next` → `MPLYt…` tab | browseId present |
| M10 Queue/radio | `next?playlistId=RDAMVM…` | 50 `playlistPanelVideoRenderer` |
| M13 Explore/Charts | `browse FEmusic_explore` / `FEmusic_charts` | Trending carousel + ~140 chart rows |
| M14 Queue/radio paging | `next` continuation | automix/radio panel ok |
| M11, M12, M15, M16 | — | **definitions not yet pinned — see open questions** |

Track ids on every YTM list live at `playlistItemData.videoId` (no
`watchEndpoint` on the row). youtube.com playlists use `lockupViewModel.contentId`.

## 3. Target routes

New namespace `/api/music/*` (keeps the existing video API untouched), plus a
catalog endpoint. All list responses use the existing conventions: `ok`, 400 bad
input, 404 no match, 502 upstream failure, `?json` to force JSON.

| Route | Maps to | Notes |
|---|---|---|
| `GET /api/music/search?q=&type=songs\|videos\|albums\|artists\|playlists` | M2 | `params` = `EgWKAQ`+byte+`AWoMEA4QChADEAQQCRAF` (songs `II`, videos `IQ`, albums `IY`, artists `Ig`, playlists `Io`) |
| `GET /api/music/home` | M3 | `browse FEmusic_home` |
| `GET /api/music/artist?id=UC…` | M5 | returns `topSongs` (from `musicShelfRenderer`), `albums`, `singles`, `videos`, `related`; each item carries `videoId`/`browseId` |
| `GET /api/music/artist/songs?id=UC…` | M5 | `browse MPAD<channelId>` |
| `GET /api/music/album?id=MPREb…` | M6 | track list + header |
| `GET /api/music/playlist?id=VL…\|PL…[&continuation=]` | M7, M10 | track list + continuation |
| `GET /api/music/song?id=<videoId>` | M4, M8 | metadata + a link to `/api/info` for streams |
| `GET /api/music/lyrics?id=<videoId>` | M9 | resolves `MPLYt…`, returns lyrics text |
| `GET /api/music/trending[?region=US]` | M13 | charts + explore shelves |
| `GET /api/music/radio?id=<videoId>` | M14 | `next?playlistId=RDAMVM<id>` queue + paging |
| `GET /api` | new | **catalog of every upstream API the server uses** (see §5) |
| `GET /api/doc` | new | API reference: every route + the upstream catalog, page or JSON |
| `GET /api/info?v=` | unchanged | video metadata (kept on `/api/info`) |

Streaming for music tracks reuses the existing `/api/info`, `/api/download`,
The video routes are unchanged (VISIONOS already returns full URLs for music ids).

## 4. Implementation steps

### Phase 0 — groundwork (no behaviour change)
1. `src/config.ts`: add a **second client** (`music`) — `WEB_REMIX`
   (`clientName: WEB_REMIX`, version e.g. `1.20261115.14.00`, header `67`) and a
   YTM key (`AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30`), both env-overridable
   (`MUSIC_CLIENT_NAME`, `MUSIC_CLIENT_VERSION`, `MUSIC_CLIENT_HEADER`, `MUSIC_API_KEY`).
2. `src/innertube.ts`: extract the request plumbing into a generic
   `innertubePost(host, key, clientConfig, path, body)` so both clients share it;
   keep `getVisitorData()` cache-able (currently fetched per call).

### Phase 1 — YouTube Music client
3. New `src/music.ts`:
   - `MUSIC_HOST = https://music.youtube.com` (fallback `youtubei.googleapis.com`).
   - `musicBrowse(browseId, params?)`, `musicSearch(query, type)`,
     `musicNext(videoId, playlistId?)`, `musicPlayer(videoId)`.
   - Tree walkers (reuse the `collectRenderers` style): pull
     `musicResponsiveListItemRenderer`, `musicTwoRowItemRenderer`,
     `musicCarouselShelfRenderer`, `musicShelfRenderer`, `playlistItemData`,
     `musicImmersiveHeaderRenderer`, `musicDetailHeaderRenderer`.
   - Normalise into the existing `SearchVideoResult`-ish shape so downstream code
     and tests share types.
4. Helpers: `parseAlbumId`, `parsePlaylistId`, `parseChannelId`, `parseTrackId`
   (accepts raw id or YTM URL).

### Phase 2 — routes
5. New `src/music-routes.ts` exporting an Express `Router` mounted at `/api/music`
   (keeps `index.ts` small). Each handler mirrors the existing error contract.
6. Wire the router in `src/index.ts`; add the new routes to the 404 `routes[]`
   list.

### Phase 3 — catalog + docs
7. New `src/catalog.ts`: a single source of truth describing every upstream API
   the server calls (see §5). Serve it from `GET /api`; `GET /api/doc` (new
   `src/docs.ts`) adds this server's own routes around it.
8. `docs/API.md`: full route reference (params, response shape, examples, error
   codes, WARP requirement). Link it from `README.md`; extend the README route
   table and the `routes[]` list.

### Phase 4 — tests
9. New `test/music.test.mjs` (same boot-the-server harness as `test/api.test.mjs`,
   no mocks, `PROXY` honoured): one test per route, asserting real shape +
   non-empty results; a paging test for playlist/radio; a bad-input test per
   route; and a `/api` catalog test asserting every declared upstream API is
   present. Anything that downloads media is kept opt-in.
10. `package.json`: `npm test` already globs `test/**/*.test.mjs` — no change.

### Phase 5 — verify
11. Run `PROXY=socks5://127.0.0.1:40000 npm test` and confirm all
    suites green; re-run the M1–M14 probe script as an independent cross-check.

## 5. `/api` — catalog of upstream APIs used

`GET /api` returns, per upstream call: `id`, `method`, `host`, `path`, `client`,
`params`/`body` essentials, `auth` (key), `requiresProxy` (bool), `usedBy`
(which routes), `verified` (bool + how). Initial contents:

| id | host / path | client | usedBy | requiresProxy |
|---|---|---|---|---|
| `visitor_id` | `youtubei.googleapis.com/youtubei/v1/visitor_id` | VISIONOS | all video routes | yes |
| `player` | `…/youtubei/v1/player` | VISIONOS | `/api/info`, `/api/link`, `/api/download`, `/api/music/song` | yes |
| `search` | `…/youtubei/v1/search` | VISIONOS | `/api/search` | yes |
| `music_search` | `music.youtube.com/youtubei/v1/search` | WEB_REMIX | `/api/music/search` | yes |
| `music_browse` | `music.youtube.com/youtubei/v1/browse` | WEB_REMIX | home, artist, album, playlist, trending | yes |
| `music_next` | `music.youtube.com/youtubei/v1/next` | WEB_REMIX | lyrics, radio/queue | yes |
| `googlevideo` | `*.googlevideo.com` (signed) | — | `/api/download` | yes (URL is IP-bound) |

Each entry also carries a short `note` (e.g. the `params` byte table, the
`playlistItemData.videoId` location, the `MPAD`/`MPREb`/`MPLYt` prefixes).

## 6. Documentation deliverables
- `docs/API.md` — every route, request params, response fields, error codes,
  curl examples, and the WARP/proxy requirement.
- `README.md` — add the `/api/music/*` and `/api` rows to the route table, the
  new env vars, and a link to `docs/API.md`.
- `AGENTS.md` — already holds the findings; add the new module map and the
  "fix the egress, not the code" note.

## 7. Risks / decisions
- **Proxy is mandatory.** On a datacenter IP, M2 songs/albums, M3 home, M8 music
  streaming, and all downloads fail. The plan documents this rather than coding
  around it.
- **Two clients.** WEB_REMIX for the music catalog, VISIONOS for media URLs. Keep
  them separate in config; never send VISIONOS headers to `music.youtube.com`.
- **Continuation tokens** differ per surface (search vs browse vs next). Store
  the surface alongside the token in the response so callers page correctly.
- **`n`-param / signature.** VISIONOS returns plain `url`s (no deciphering), so
  the music routes need no JS signature logic. If a future client needs it, that
  is a separate task.
- **Rate limits.** YTM browse/next are cheaper than `player`; still add the same
  retry/backoff used by `getVideoInfo`.

## 8. Open questions (need answers before Phase 1)
1. The 16-module plan — what exactly are **M11, M12, M15, M16**? They were never
   specified, so they are not in this plan.
2. Should the music routes be **anonymous** (no cookies) only, or also accept an
   optional `Cookie`/`Authorization` for personalised home/library?
3. Keep the `/api/music/*` namespace, or fold into `/api/*` with a `surface=music`
   param?
