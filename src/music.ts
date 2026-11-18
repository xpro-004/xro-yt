/**
 * YouTube Music catalogue client (WEB_REMIX). All of this talks to
 * `music.youtube.com/youtubei/v1/{browse,search,next}` and parses the
 * `music*Renderer` shapes. Media URLs are NOT minted here — the music routes
 * hand track ids to the existing VISIONOS player path (`/api/video` & friends).
 *
 * Everything here needs a non-datacenter egress: without a proxy (WARP) the
 * catalogue answers "No results" for songs/albums and the home page comes back
 * nearly empty. See AGENTS.md.
 */
import { config } from "./config.js";
import { requestJson } from "./http.js";

export type MusicKind =
  | "song"
  | "video"
  | "album"
  | "artist"
  | "playlist"
  | "episode"
  | "podcast"
  | "unknown";

export interface MusicItem {
  kind: MusicKind;
  title: string;
  subtitle?: string;
  videoId?: string;
  browseId?: string;
  playlistId?: string;
  duration?: string;
  durationSeconds?: number;
  year?: string;
  plays?: string;
  thumbnail?: string;
}

export interface MusicShelf {
  title: string;
  items: MusicItem[];
  continuation?: string;
}

export type MusicSearchType = "songs" | "videos" | "albums" | "artists" | "playlists";

/** `params` byte for each search filter (base64 protobuf). */
const SEARCH_FILTER: Record<MusicSearchType, string> = {
  songs: "EgWKAQIIAWoMEA4QChADEAQQCRAF",
  videos: "EgWKAQIQAWoMEA4QChADEAQQCRAF",
  albums: "EgWKAQIYAWoMEA4QChADEAQQCRAF",
  artists: "EgWKAQIgAWoMEA4QChADEAQQCRAF",
  playlists: "EgWKAQIoAWoMEA4QChADEAQQCRAF",
};

const SEARCH_KIND: Record<MusicSearchType, MusicKind> = {
  songs: "song",
  videos: "video",
  albums: "album",
  artists: "artist",
  playlists: "playlist",
};

function musicHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": config.music.userAgent,
    "X-Youtube-Client-Name": config.music.clientNameHeader,
    "X-Youtube-Client-Version": config.music.clientVersion,
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function musicContext() {
  return {
    client: {
      clientName: config.music.clientName,
      clientVersion: config.music.clientVersion,
      hl: "en",
      gl: "US",
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST to the music host with retries and upstream-error surfacing. */
async function musicPost(path: string, body: Record<string, unknown>, retries = 3): Promise<any> {
  const url = `${config.music.host}/youtubei/v1/${path}?key=${config.music.apiKey}&prettyPrint=false`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await requestJson<any>(url, {
        method: "POST",
        headers: musicHeaders(),
        body: JSON.stringify({ context: musicContext(), ...body }),
        proxy: config.proxy,
        timeoutMs: config.timeoutMs,
      });
      if (res?.error) {
        const msg = res.error.message ?? res.error.status ?? JSON.stringify(res.error);
        throw new Error(`music upstream error: ${msg}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// tree walking + text helpers
// ---------------------------------------------------------------------------

function walk(root: any, visit: (key: string, node: any) => void): void {
  if (!root || typeof root !== "object") return;
  if (Array.isArray(root)) {
    for (const item of root) walk(item, visit);
    return;
  }
  for (const key of Object.keys(root)) {
    const child = root[key];
    visit(key, child);
    walk(child, visit);
  }
}

/** InnerTube text node: `{simpleText}` or `{runs:[{text}]}`. */
function textOf(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? "").join("");
  return "";
}

/** Highest-resolution thumbnail from any `musicThumbnailRenderer`/thumbnail node. */
function thumbOf(renderer: any): string | undefined {
  const list =
    renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    renderer?.thumbnail?.thumbnails;
  return Array.isArray(list) && list.length > 0 ? list[list.length - 1]?.url : undefined;
}

function durationToSeconds(text: string): number {
  const parts = text.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function pageTypeOf(nav: any): string | undefined {
  return (
    nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
      ?.pageType
  );
}

const PAGE_TYPE_KIND: Record<string, MusicKind> = {
  MUSIC_PAGE_TYPE_ALBUM: "album",
  MUSIC_PAGE_TYPE_AUDIOBOOK: "album",
  MUSIC_PAGE_TYPE_ARTIST: "artist",
  MUSIC_PAGE_TYPE_PLAYLIST: "playlist",
  MUSIC_PAGE_TYPE_PODCAST_SHOW: "podcast",
  MUSIC_PAGE_TYPE_TRACK: "song",
};

function kindFromBrowseId(browseId: string | undefined): MusicKind | undefined {
  if (!browseId) return undefined;
  if (browseId.startsWith("MPREb") || browseId.startsWith("OLAK5uy_")) return "album";
  if (browseId.startsWith("MPLA") || browseId.startsWith("UC")) return "artist";
  if (browseId.startsWith("VL") || browseId.startsWith("PL") || browseId.startsWith("RD")) {
    return "playlist";
  }
  return undefined;
}

function inferKind(opts: {
  hint?: MusicKind;
  videoId?: string;
  browseId?: string;
  pageType?: string;
}): MusicKind {
  if (opts.pageType && PAGE_TYPE_KIND[opts.pageType]) return PAGE_TYPE_KIND[opts.pageType];
  const fromId = kindFromBrowseId(opts.browseId);
  if (fromId) return fromId;
  if (opts.videoId) return opts.hint === "video" ? "video" : "song";
  return opts.hint ?? "unknown";
}

/** Playlist ids arrive as `VL<id>`; accept a bare id, `VL…`, or a URL. */
export function parsePlaylistId(input: string): string {
  const s = input.trim();
  if (s.startsWith("VL")) return s;
  return `VL${s}`;
}

/** Accept a bare id or any YouTube/YouTube Music URL and return the id. */
export function parseMusicId(input: string): string {
  const s = input.trim();
  if (!/^https?:\/\//i.test(s)) return s;
  const u = new URL(s);
  const list = u.searchParams.get("list");
  if (list) return list;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = u.pathname.match(/\/(?:browse|channel|playlist)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return u.pathname.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// renderer parsers
// ---------------------------------------------------------------------------

function parseListItem(r: any, hint?: MusicKind): MusicItem | undefined {
  const cols: any[] = r.flexColumns ?? [];
  const title = textOf(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text).trim();
  if (!title) return undefined;
  const subtitle = textOf(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text).trim();

  const videoId =
    r.playlistItemData?.videoId ??
    r.navigationEndpoint?.watchEndpoint?.videoId ??
    cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint
      ?.watchEndpoint?.videoId;

  const browseId =
    r.navigationEndpoint?.browseEndpoint?.browseId ??
    cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint
      ?.browseEndpoint?.browseId;

  const pageType =
    pageTypeOf(r.navigationEndpoint) ??
    pageTypeOf(
      cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint,
    );

  const fixed = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text;
  const durationText = textOf(fixed).trim() || (subtitle.match(/\b\d+:\d{2}\b/) ?? [""])[0];
  const year = (subtitle.match(/\b(?:19|20)\d{2}\b/) ?? [])[0];
  const plays = (subtitle.match(/[\d.,]+[KMB]? plays/) ?? [])[0];

  const kind = inferKind({ hint, videoId, browseId, pageType });
  return {
    kind,
    title,
    subtitle: subtitle || undefined,
    videoId,
    browseId,
    playlistId: kind === "playlist" && browseId ? browseId.replace(/^VL/, "") : undefined,
    duration: durationText || undefined,
    durationSeconds: durationText ? durationToSeconds(durationText) : undefined,
    year,
    plays,
    thumbnail: thumbOf(r),
  };
}

function parseTwoRow(r: any, hint?: MusicKind): MusicItem | undefined {
  const title = textOf(r.title).trim();
  if (!title) return undefined;
  const subtitle = textOf(r.subtitle).trim();
  const videoId = r.navigationEndpoint?.watchEndpoint?.videoId;
  const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
  const pageType = pageTypeOf(r.navigationEndpoint);
  const kind = inferKind({ hint, videoId, browseId, pageType });
  return {
    kind,
    title,
    subtitle: subtitle || undefined,
    videoId,
    browseId,
    playlistId: kind === "playlist" && browseId ? browseId.replace(/^VL/, "") : undefined,
    thumbnail: thumbOf(r),
  };
}

function parsePlaylistPanel(r: any, hint?: MusicKind): MusicItem | undefined {
  const title = textOf(r.title).trim();
  if (!title) return undefined;
  const videoId = r.navigationEndpoint?.watchEndpoint?.videoId ?? r.videoId;
  const subtitle = textOf(r.longBylineText ?? r.shortBylineText).trim();
  const durationText = textOf(r.lengthText).trim();
  return {
    kind: inferKind({ hint, videoId }),
    title,
    subtitle: subtitle || undefined,
    videoId,
    duration: durationText || undefined,
    durationSeconds: durationText ? durationToSeconds(durationText) : undefined,
    thumbnail: thumbOf(r),
  };
}

function collectItems(root: any, hint?: MusicKind): MusicItem[] {
  const out: MusicItem[] = [];
  const seen = new Set<string>();
  walk(root, (key, node) => {
    const item =
      key === "musicResponsiveListItemRenderer"
        ? parseListItem(node, hint)
        : key === "musicTwoRowItemRenderer"
          ? parseTwoRow(node, hint)
          : key === "playlistPanelVideoRenderer"
            ? parsePlaylistPanel(node, hint)
            : undefined;
    if (!item) return;
    const dedupe = `${item.kind}:${item.videoId ?? item.browseId ?? item.title}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(item);
  });
  return out;
}

function shelfTitle(shelf: any): string {
  return (
    textOf(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title) ||
    textOf(shelf.header?.musicShelfBasicHeaderRenderer?.title) ||
    textOf(shelf.title) ||
    ""
  ).trim();
}

function continuationIn(node: any): string | undefined {
  let token: string | undefined;
  walk(node, (key, child) => {
    if (!token && key === "nextContinuationData" && typeof child?.continuation === "string") {
      token = child.continuation;
    }
  });
  return token;
}

function collectShelves(root: any, hint?: MusicKind): MusicShelf[] {
  const shelves: MusicShelf[] = [];
  walk(root, (key, node) => {
    if (key !== "musicCarouselShelfRenderer" && key !== "musicShelfRenderer") return;
    const items = collectItems(node, hint);
    if (items.length === 0) return;
    shelves.push({ title: shelfTitle(node), items, continuation: continuationIn(node) });
  });
  return shelves;
}

export interface MusicHeader {
  title: string;
  subtitle?: string;
  secondSubtitle?: string;
  description?: string;
  subscribers?: string;
  thumbnail?: string;
  browseId?: string;
}

function parseHeader(root: any): MusicHeader | undefined {
  let found: any;
  walk(root, (key, node) => {
    if (
      !found &&
      (key === "musicDetailHeaderRenderer" ||
        key === "musicImmersiveHeaderRenderer" ||
        key === "musicResponsiveHeaderRenderer")
    ) {
      found = node;
    }
  });
  if (!found) return undefined;
  const subscribers =
    textOf(found.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText) ||
    textOf(found.subtitle)?.match(/[\d.,]+[KMB]? subscribers/)?.[0];
  return {
    title: textOf(found.title).trim(),
    subtitle: textOf(found.subtitle).trim() || undefined,
    secondSubtitle: textOf(found.secondSubtitle).trim() || undefined,
    description: textOf(found.description).trim() || undefined,
    subscribers,
    thumbnail: thumbOf(found),
    browseId: found.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId,
  };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface MusicSearchResults {
  query: string;
  type: MusicSearchType;
  count: number;
  results: MusicItem[];
  continuation?: string;
}

export async function musicSearch(
  query: string,
  type: MusicSearchType,
  continuation?: string,
): Promise<MusicSearchResults> {
  const body: Record<string, unknown> = continuation
    ? { continuation }
    : { query, params: SEARCH_FILTER[type] };
  const res = await musicPost("search", body);
  const results = collectItems(res, SEARCH_KIND[type]);
  return { query, type, count: results.length, results, continuation: continuationIn(res) };
}

export interface MusicHome {
  shelves: MusicShelf[];
}

export async function musicHome(): Promise<MusicHome> {
  const res = await musicPost("browse", { browseId: "FEmusic_home" });
  return { shelves: collectShelves(res) };
}

export interface MusicArtist {
  artist: MusicHeader | null;
  topSongs: MusicItem[];
  albums: MusicItem[];
  singles: MusicItem[];
  videos: MusicItem[];
  related: MusicItem[];
  shelves: MusicShelf[];
}

function shelfByTitle(shelves: MusicShelf[], needle: string): MusicItem[] {
  const s = shelves.find((x) => x.title.toLowerCase().includes(needle.toLowerCase()));
  return s ? s.items : [];
}

export async function musicArtist(channelId: string): Promise<MusicArtist> {
  const res = await musicPost("browse", { browseId: channelId });
  const shelves = collectShelves(res);
  return {
    artist: parseHeader(res) ?? null,
    topSongs: shelfByTitle(shelves, "top songs"),
    albums: shelfByTitle(shelves, "albums"),
    singles: shelfByTitle(shelves, "singles"),
    videos: shelfByTitle(shelves, "videos"),
    related: shelfByTitle(shelves, "fans might also like") ?? shelfByTitle(shelves, "related"),
    shelves,
  };
}

export interface MusicList {
  header: MusicHeader | null;
  items: MusicItem[];
  continuation?: string;
}

export async function musicArtistSongs(channelId: string): Promise<MusicList> {
  const res = await musicPost("browse", { browseId: `MPAD${channelId}`, params: "ggMIegYIARoCAQI=" });
  return { header: parseHeader(res) ?? null, items: collectItems(res), continuation: continuationIn(res) };
}

export async function musicAlbum(browseId: string): Promise<MusicList> {
  const res = await musicPost("browse", { browseId });
  return { header: parseHeader(res) ?? null, items: collectItems(res), continuation: continuationIn(res) };
}

export async function musicPlaylist(
  playlistId: string,
  continuation?: string,
): Promise<MusicList> {
  const body: Record<string, unknown> = continuation
    ? { continuation }
    : { browseId: parsePlaylistId(playlistId) };
  const res = await musicPost("browse", body);
  return { header: parseHeader(res) ?? null, items: collectItems(res), continuation: continuationIn(res) };
}

export async function musicTrending(): Promise<{ shelves: MusicShelf[] }> {
  const [charts, explore] = await Promise.all([
    musicPost("browse", { browseId: "FEmusic_charts" }),
    musicPost("browse", { browseId: "FEmusic_explore" }),
  ]);
  return { shelves: [...collectShelves(charts), ...collectShelves(explore)] };
}

export async function musicRadio(videoId: string, continuation?: string): Promise<MusicList> {
  const body: Record<string, unknown> = continuation
    ? { continuation }
    : { videoId, playlistId: `RDAMVM${videoId}` };
  const res = await musicPost("next", body);
  return { header: parseHeader(res) ?? null, items: collectItems(res), continuation: continuationIn(res) };
}

/** Resolve and fetch lyrics for a track (the `next` panel exposes an `MPLYt…` tab). */
export async function musicLyrics(videoId: string): Promise<{ lyrics: string | null; browseId: string | null }> {
  const panel = await musicPost("next", { videoId });
  let browseId: string | null = null;
  walk(panel, (key, node) => {
    if (browseId) return;
    if (key !== "browseEndpoint") return;
    const id = node?.browseId;
    if (typeof id === "string" && id.startsWith("MPLYt")) browseId = id;
  });
  if (!browseId) return { lyrics: null, browseId: null };
  const res = await musicPost("browse", { browseId });
  let lyrics: string | null = null;
  walk(res, (key, node) => {
    if (lyrics) return;
    if (key === "musicDescriptionShelfRenderer") {
      const t = textOf(node.description).trim();
      if (t) lyrics = t;
    }
  });
  return { lyrics, browseId };
}
