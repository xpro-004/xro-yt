import { config } from "./config.js";
import { requestJson } from "./http.js";

/** Subset of the InnerTube player response we care about. */
export interface RawFormat {
  itag: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  qualityLabel?: string;
  audioQuality?: string;
  audioSampleRate?: string;
  fps?: number;
  width?: number;
  height?: number;
}

export interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: {
    expiresInSeconds?: string;
    formats?: RawFormat[];
    adaptiveFormats?: RawFormat[];
    hlsManifestUrl?: string;
    dashManifestUrl?: string;
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    author?: string;
    viewCount?: string;
    shortDescription?: string;
  };
}

export interface FormatInfo {
  itag: number;
  url: string;
  mimeType: string;
  /** "video" | "audio" | "muxed" */
  kind: "video" | "audio" | "muxed";
  container: string;
  codec: string;
  quality: string;
  bitrate: number;
  contentLength: number;
  fps?: number;
  width?: number;
  height?: number;
  audioSampleRate?: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  lengthSeconds: number;
  viewCount: number;
  hlsManifestUrl?: string;
  dashManifestUrl?: string;
  expiresInSeconds: number;
  formats: FormatInfo[];
}

const CLIENT_HEADERS = (visitorData: string): Record<string, string> => ({
  "Content-Type": "application/json",
  "User-Agent": config.client.userAgent,
  "X-Youtube-Client-Name": config.client.clientNameHeader,
  "X-Youtube-Client-Version": config.client.clientVersion,
  "X-Goog-Visitor-Id": visitorData,
  "X-Goog-Api-Format-Version": "2",
  "Accept-Language": "en-US,en;q=0.9",
});

/** Extract a video id from a raw id or any common YouTube URL form. */
export function parseVideoId(input: string): string {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12);
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  } catch {
    /* not a URL */
  }
  throw new Error(`Could not parse a video id from: ${input}`);
}

function clientContext(visitorData: string) {
  return {
    client: {
      clientName: config.client.clientName,
      clientVersion: config.client.clientVersion,
      deviceMake: config.client.deviceMake,
      deviceModel: config.client.deviceModel,
      osName: config.client.osName,
      osVersion: config.client.osVersion,
      hl: "en",
      gl: "US",
      visitorData,
    },
  };
}

/** Search result filter sent as `params` (base64 protobuf). */
export type SearchType = "video" | "channel" | "playlist" | "all";

const SEARCH_PARAMS: Record<Exclude<SearchType, "all">, string> = {
  video: "EgIQAQ==",
  channel: "EgIQAg==",
  playlist: "EgIQAw==",
};

export interface SearchVideoResult {
  kind: "video";
  videoId: string;
  title: string;
  channel: string;
  channelId?: string;
  lengthSeconds: number;
  lengthText?: string;
  viewCount?: number;
  viewCountText?: string;
  publishedTimeText?: string;
  thumbnail?: string;
}

export interface SearchChannelResult {
  kind: "channel";
  channelId: string;
  title: string;
  handle?: string;
  subscriberCountText?: string;
  thumbnail?: string;
}

export interface SearchPlaylistResult {
  kind: "playlist";
  playlistId: string;
  title: string;
  channel?: string;
  videoCountText?: string;
  thumbnail?: string;
}

export type SearchResult = SearchVideoResult | SearchChannelResult | SearchPlaylistResult;

export interface SearchResults {
  query: string;
  type: SearchType;
  count: number;
  results: SearchResult[];
  /** Pass back as `continuation` to fetch the next page. */
  continuation?: string;
}

/** InnerTube text nodes come as `{ simpleText }` or `{ runs: [{ text }] }`. */
function textOf(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? "").join("");
  return "";
}

/** Highest-resolution entry of a `thumbnail.thumbnails` list. */
function thumbOf(node: any): string | undefined {
  const list = node?.thumbnails;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[list.length - 1]?.url;
}

/** "4:35" / "1:02:03" -> seconds. */
function durationToSeconds(text: string): number {
  const parts = text.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** "1,234,567 views" -> 1234567. */
function viewsToNumber(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : undefined;
}

/**
 * Search responses mix the requested renderers into section lists and shelves,
 * and the nesting changes with the filter, so walk the tree and pick out every
 * renderer we understand rather than hard-coding paths.
 */
function collectRenderers(root: any): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const v = node.compactVideoRenderer ?? node.videoRenderer;
    if (v?.videoId && !seen.has("v" + v.videoId)) {
      seen.add("v" + v.videoId);
      const lengthText = textOf(v.lengthText);
      out.push({
        kind: "video",
        videoId: v.videoId,
        title: textOf(v.title),
        channel: textOf(v.shortBylineText ?? v.longBylineText ?? v.ownerText),
        channelId: v.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId,
        lengthSeconds: durationToSeconds(lengthText),
        lengthText: lengthText || undefined,
        viewCount: viewsToNumber(textOf(v.viewCountText ?? v.shortViewCountText)),
        viewCountText: textOf(v.shortViewCountText ?? v.viewCountText) || undefined,
        publishedTimeText: textOf(v.publishedTimeText) || undefined,
        thumbnail: thumbOf(v.thumbnail),
      });
    }
    const c = node.compactChannelRenderer ?? node.channelRenderer;
    if (c?.channelId && !seen.has("c" + c.channelId)) {
      seen.add("c" + c.channelId);
      out.push({
        kind: "channel",
        channelId: c.channelId,
        title: textOf(c.displayName ?? c.title),
        // These two fields are swapped in the response: `subscriberCountText`
        // holds the handle ("@name") and `videoCountText` the subscriber line.
        handle: textOf(c.subscriberCountText) || undefined,
        subscriberCountText: textOf(c.videoCountText) || undefined,
        thumbnail: thumbOf(c.thumbnail),
      });
    }
    const p = node.compactPlaylistRenderer ?? node.playlistRenderer;
    if (p?.playlistId && !seen.has("p" + p.playlistId)) {
      seen.add("p" + p.playlistId);
      out.push({
        kind: "playlist",
        playlistId: p.playlistId,
        title: textOf(p.title),
        channel: textOf(p.shortBylineText ?? p.longBylineText) || undefined,
        videoCountText: textOf(p.videoCountText ?? p.videoCountShortText) || undefined,
        thumbnail: thumbOf(p.thumbnail),
      });
    }
    for (const key of Object.keys(node)) {
      if (key === "thumbnail" || key === "thumbnails" || key === "sidebarThumbnails") continue;
      visit(node[key]);
    }
  };
  visit(root);
  return out;
}

/**
 * Pull the "show more" token. Only `nextContinuationData` advances the list —
 * `reloadContinuationData` (which the section list also carries) re-serves the
 * first page — so walk for the first `nextContinuationData` regardless of how
 * the response nests it (the shape changes between the first page and later
 * ones, and between search filters).
 */
function continuationOf(root: any): string | undefined {
  let token: string | undefined;
  const visit = (node: any) => {
    if (token || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node.nextContinuationData?.continuation === "string") {
      token = node.nextContinuationData.continuation;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "thumbnail" || key === "thumbnails") continue;
      visit(node[key]);
    }
  };
  visit(root);
  return token;
}

/**
 * Run a YouTube search through InnerTube. Pass the previous response's
 * `continuation` to page through further results.
 */
export async function searchYouTube(
  query: string,
  opts: { type?: SearchType; continuation?: string } = {},
): Promise<SearchResults> {
  const type = opts.type ?? "video";
  const q = query.trim();
  if (!q && !opts.continuation) throw new Error("missing search query");

  const visitorData = await getVisitorData();
  const body = JSON.stringify({
    context: clientContext(visitorData),
    ...(opts.continuation
      ? { continuation: opts.continuation }
      : { query: q, ...(type !== "all" ? { params: SEARCH_PARAMS[type] } : {}) }),
  });

  const res = await requestJson<any>(
    `${config.hosts[0]}/youtubei/v1/search?key=${config.apiKey}&prettyPrint=false`,
    {
      method: "POST",
      headers: CLIENT_HEADERS(visitorData),
      body,
      proxy: config.proxy,
      timeoutMs: config.timeoutMs,
    },
  );

  const results = collectRenderers(res);
  return {
    query: q,
    type,
    count: results.length,
    results,
    continuation: continuationOf(res),
  };
}

/**
 * visitorData is a stable per-device token; re-fetching it on every player and
 * search call doubles the proxy round-trips for no benefit.
 */
let visitorCache: { value: string; at: number } | undefined;
const VISITOR_TTL_MS = 6 * 60 * 60 * 1000;

async function getVisitorData(): Promise<string> {
  if (visitorCache && Date.now() - visitorCache.at < VISITOR_TTL_MS) {
    return visitorCache.value;
  }
  const body = JSON.stringify({
    context: { client: { clientName: config.client.clientName, clientVersion: config.client.clientVersion, hl: "en", gl: "US" } },
  });
  const data = await requestJson<{ responseContext?: { visitorData?: string } }>(
    `${config.hosts[0]}/youtubei/v1/visitor_id?key=${config.apiKey}&prettyPrint=false`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": config.client.userAgent },
      body,
      proxy: config.proxy,
      timeoutMs: config.timeoutMs,
    },
  );
  const vd = data.responseContext?.visitorData;
  if (!vd) throw new Error("visitor_id response missing visitorData");
  visitorCache = { value: vd, at: Date.now() };
  return vd;
}

function classify(f: RawFormat): FormatInfo["kind"] {
  const mime = f.mimeType ?? "";
  if (mime.startsWith("audio")) return "audio";
  if (mime.startsWith("video") && f.audioQuality) return "muxed";
  return "video";
}

function toFormatInfo(f: RawFormat): FormatInfo | undefined {
  if (!f.url) return undefined;
  const mime = f.mimeType ?? "";
  const [container, codecPart] = mime.split(";");
  const codec = (codecPart ?? "").replace(/codecs="?|"?/g, "").trim() || "unknown";
  return {
    itag: f.itag,
    url: f.url,
    mimeType: mime,
    kind: classify(f),
    container: container.split("/")[1] ?? "unknown",
    codec,
    quality: f.qualityLabel ?? f.audioQuality ?? "unknown",
    bitrate: f.bitrate ?? 0,
    contentLength: Number(f.contentLength ?? 0),
    fps: f.fps,
    width: f.width,
    height: f.height,
    audioSampleRate: f.audioSampleRate,
  };
}

/**
 * Player responses are cached for a fraction of their signed-URL lifetime.
 * Browsers issue a burst of range requests for one video (metadata probe, then
 * sequential chunks, then seek storms) and each would otherwise pay for a fresh
 * visitor_id + player round-trip through the proxy before the first byte.
 */
const infoCache = new Map<string, { at: number; value: VideoInfo }>();
const INFO_CACHE_MAX = 200;

function cacheGet(videoId: string): VideoInfo | undefined {
  const hit = infoCache.get(videoId);
  if (!hit) return undefined;
  const ttlMs = Math.max(60_000, Math.min(hit.value.expiresInSeconds * 1000 * 0.5, 3_600_000));
  if (Date.now() - hit.at > ttlMs) {
    infoCache.delete(videoId);
    return undefined;
  }
  return hit.value;
}

function cacheSet(videoId: string, value: VideoInfo): void {
  if (infoCache.size >= INFO_CACHE_MAX) {
    const oldest = infoCache.keys().next().value;
    if (oldest !== undefined) infoCache.delete(oldest);
  }
  infoCache.set(videoId, { at: Date.now(), value });
}

/**
 * Call the InnerTube player API with the configured client and return parsed
 * video info plus per-format direct media URLs.
 */
export async function getVideoInfo(rawIdOrUrl: string): Promise<VideoInfo> {
  const videoId = parseVideoId(rawIdOrUrl);

  const cached = cacheGet(videoId);
  if (cached) return cached;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      const visitorData = await getVisitorData();
      const body = JSON.stringify({
        context: clientContext(visitorData),
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      });

      const pr = await requestJson<PlayerResponse>(
        `${config.hosts[0]}/youtubei/v1/player?key=${config.apiKey}&prettyPrint=false`,
        {
          method: "POST",
          headers: CLIENT_HEADERS(visitorData),
          body,
          proxy: config.proxy,
          timeoutMs: config.timeoutMs,
        },
      );

      const status = pr.playabilityStatus?.status;
      if (status && status !== "OK") {
        throw new Error(`playabilityStatus=${status}: ${pr.playabilityStatus?.reason ?? ""}`);
      }
      const sd = pr.streamingData;
      if (!sd) throw new Error("player response has no streamingData");

      const all = [...(sd.formats ?? []), ...(sd.adaptiveFormats ?? [])];
      const formats = all
        .map(toFormatInfo)
        .filter((f): f is FormatInfo => Boolean(f))
        .sort((a, b) => b.bitrate - a.bitrate);

      if (formats.length === 0) throw new Error("no downloadable formats returned");

      const info: VideoInfo = {
        videoId,
        title: pr.videoDetails?.title ?? "",
        author: pr.videoDetails?.author ?? "",
        lengthSeconds: Number(pr.videoDetails?.lengthSeconds ?? 0),
        viewCount: Number(pr.videoDetails?.viewCount ?? 0),
        hlsManifestUrl: sd.hlsManifestUrl,
        dashManifestUrl: sd.dashManifestUrl,
        expiresInSeconds: Number(sd.expiresInSeconds ?? 0),
        formats,
      };
      cacheSet(videoId, info);
      return info;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`player API failed after ${config.retries} attempts: ${String(lastErr)}`);
}
