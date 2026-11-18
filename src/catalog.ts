/**
 * Machine-readable catalogue of every upstream API this server calls, with the
 * client, params and proxy requirement for each. Served from `GET /api` (and
 * `GET /api`). Keep this in sync with `innertube.ts`,
 * `music.ts` and `stream.ts`.
 */
import { config } from "./config.js";

export interface UpstreamApi {
  id: string;
  method: "POST" | "GET";
  host: string;
  path: string;
  client: string;
  /** API key used (the key is embedded in the query string). */
  auth: string;
  /** What has to go in the request body, in brief. */
  request: string;
  /** Which of this server's routes use it. */
  usedBy: string[];
  /** Signed media URLs are bound to the requesting IP, so a proxy is required. */
  requiresProxy: boolean;
  verified: boolean;
  note?: string;
}

export function upstreamCatalog(): UpstreamApi[] {
  const visionos = `${config.client.clientName} ${config.client.clientVersion}`;
  const webRemix = `${config.music.clientName} ${config.music.clientVersion}`;
  const videoHost = config.hosts[0];
  const musicHost = config.music.host;
  return [
    {
      id: "visitor_id",
      method: "POST",
      host: videoHost,
      path: "/youtubei/v1/visitor_id",
      client: visionos,
      auth: config.apiKey,
      request: "{}",
      usedBy: ["/api/search", "/api/video", "/api/link", "/api/download"],
      requiresProxy: true,
      verified: true,
      note: "Returns visitorData, sent back as the X-Goog-Visitor-Id header. Without it the player answers LOGIN_REQUIRED.",
    },
    {
      id: "player",
      method: "POST",
      host: videoHost,
      path: "/youtubei/v1/player",
      client: visionos,
      auth: config.apiKey,
      request: "videoId, contentCheckOk, racyCheckOk, context.client{visitorData}",
      usedBy: ["/api/video", "/api/link", "/api/download", "/api/music/song"],
      requiresProxy: true,
      verified: true,
      note: "VISIONOS serves the whole file with a plain url (no signatureCipher) and needs no PO token — but only from a non-datacenter IP.",
    },
    {
      id: "search",
      method: "POST",
      host: videoHost,
      path: "/youtubei/v1/search",
      client: visionos,
      auth: config.apiKey,
      request: "query, params (EgIQAQ== video / EgIQAg== channel / EgIQAw== playlist), continuation",
      usedBy: ["/api/search"],
      requiresProxy: true,
      verified: true,
    },
    {
      id: "music_search",
      method: "POST",
      host: musicHost,
      path: "/youtubei/v1/search",
      client: webRemix,
      auth: config.music.apiKey,
      request: "query, params (EgWKAQ + type byte + AWoMEA4QChADEAQQCRAF), continuation",
      usedBy: ["/api/music/search"],
      requiresProxy: true,
      verified: true,
      note: "Type bytes: songs II, videos IQ, albums IY, artists Ig, playlists Io.",
    },
    {
      id: "music_browse",
      method: "POST",
      host: musicHost,
      path: "/youtubei/v1/browse",
      client: webRemix,
      auth: config.music.apiKey,
      request: "browseId (FEmusic_home|FEmusic_charts|FEmusic_explore|UC…|MPREb…|VL…|MPAD…), params, continuation",
      usedBy: [
        "/api/music/home",
        "/api/music/artist",
        "/api/music/artist/songs",
        "/api/music/album",
        "/api/music/playlist",
        "/api/music/trending",
      ],
      requiresProxy: true,
      verified: true,
      note: "Track ids live at playlistItemData.videoId. Artist 'Top songs' is a musicShelfRenderer; 'More' is MPAD<channelId>.",
    },
    {
      id: "music_next",
      method: "POST",
      host: musicHost,
      path: "/youtubei/v1/next",
      client: webRemix,
      auth: config.music.apiKey,
      request: "videoId, playlistId (RDAMVM<videoId> for radio), continuation",
      usedBy: ["/api/music/radio", "/api/music/lyrics"],
      requiresProxy: true,
      verified: true,
      note: "Queue rows are playlistPanelVideoRenderer; lyrics tab browseId is MPLYt….",
    },
    {
      id: "googlevideo",
      method: "GET",
      host: "*.googlevideo.com",
      path: "/videoplayback?…",
      client: "—",
      auth: "signed URL (short-lived)",
      request: "Range: bytes=… (4 MiB chunks), follows 302",
      usedBy: ["/api/download"],
      requiresProxy: true,
      verified: true,
      note: "The signed URL embeds ip=…; it only serves from the same egress that minted it, so downloads need the same proxy as the player call.",
    },
  ];
}
