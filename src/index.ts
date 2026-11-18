import express, { type Request, type Response } from "express";
import { config } from "./config.js";
import { getVideoInfo, searchYouTube, type FormatInfo, type SearchType } from "./innertube.js";
import { streamMedia } from "./stream.js";
import { renderHome } from "./home.js";
import { musicRouter } from "./music-routes.js";
import { upstreamCatalog } from "./catalog.js";

const app = express();
app.use(express.json());

const startedAt = Date.now();

/** Browsers get a page; everyone else gets JSON. */
function wantsHtml(req: Request): boolean {
  if (req.query.json !== undefined) return false;
  const accept = String(req.headers.accept ?? "");
  return accept.includes("text/html");
}

app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(renderHome());
});

function fmtPublic(base: string, v: { videoId: string }, f: FormatInfo) {
  return {
    itag: f.itag,
    kind: f.kind,
    quality: f.quality,
    container: f.container,
    codec: f.codec,
    bitrate: f.bitrate,
    contentLength: f.contentLength,
    fps: f.fps,
    width: f.width,
    height: f.height,
    audioSampleRate: f.audioSampleRate,
    /** Direct googlevideo URL (short-lived; `expiresInSeconds` tells you how long). */
    directUrl: f.url,
    /** Same file, proxied through this server — use this one from a browser. */
    proxyUrl: `${base}/api/download?v=${encodeURIComponent(v.videoId)}&itag=${f.itag}`,
  };
}

function baseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol;
  return `${proto}://${req.get("host")}`;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    client: config.client.clientName,
    clientVersion: config.client.clientVersion,
    musicClient: config.music.clientName,
    proxy: config.proxy || "direct",
    host: config.hosts[0],
  });
});

/**
 * GET /api — catalogue of every upstream API this server calls, with the client,
 * params and proxy requirement for each.
 */
app.get("/api", (_req, res) => {
  const apis = upstreamCatalog();
  res.json({
    ok: true,
    name: "vidmate-yt-api",
    videoClient: `${config.client.clientName} ${config.client.clientVersion}`,
    musicClient: `${config.music.clientName} ${config.music.clientVersion}`,
    proxy: config.proxy || "direct",
    count: apis.length,
    apis,
    routes: [
      "GET /",
      "GET /health",
      "GET /api",
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
      "GET /api/music/radio?id=",
    ],
  });
});

app.use("/api/music", musicRouter);

/**
 * GET /api/info?v=<id|url>[&format=video|audio|muxed][&maxHeight=1080]
 * Returns metadata plus every format with direct and proxied download links.
 * Opened in a browser without `v`, shows the UI instead.
 */
app.get("/api/info", async (req: Request, res: Response) => {
  const input = String(req.query.v ?? req.query.url ?? req.query.id ?? "").trim();
  if (!input) {
    if (wantsHtml(req)) {
      res.type("html").send(renderHome());
      return;
    }
    // No `v`: describe the upstream APIs instead of erroring.
    const apis = upstreamCatalog();
    res.json({ ok: true, hint: "pass ?v=<id|url> for video info", count: apis.length, apis });
    return;
  }
  try {
    const info = await getVideoInfo(input);
    const base = baseUrl(req);
    const kind = req.query.format ? String(req.query.format) : undefined;
    const maxHeight = req.query.maxHeight ? Number(req.query.maxHeight) : undefined;

    let formats = info.formats;
    if (kind) formats = formats.filter((f) => f.kind === kind);
    if (maxHeight) formats = formats.filter((f) => !f.height || f.height <= maxHeight);

    res.json({
      ok: true,
      video: {
        videoId: info.videoId,
        title: info.title,
        author: info.author,
        lengthSeconds: info.lengthSeconds,
        viewCount: info.viewCount,
      },
      hlsManifestUrl: info.hlsManifestUrl,
      dashManifestUrl: info.dashManifestUrl,
      expiresInSeconds: info.expiresInSeconds,
      count: formats.length,
      formats: formats.map((f) => fmtPublic(base, info, f)),
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

/**
 * GET /api/search?q=<query>[&type=video|channel|playlist|all][&continuation=<token>]
 * Searches YouTube and returns results with ready-to-use video/download links.
 * Pass the returned `continuation` back to fetch the next page.
 */
app.get("/api/search", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? req.query.query ?? req.query.search ?? "").trim();
  const continuation = req.query.continuation ? String(req.query.continuation) : undefined;
  const typeParam = String(req.query.type ?? "video").toLowerCase();
  if (!["video", "channel", "playlist", "all"].includes(typeParam)) {
    res.status(400).json({ ok: false, error: "invalid type; use video|channel|playlist|all" });
    return;
  }
  if (!q && !continuation) {
    res.status(400).json({ ok: false, error: "missing query param: q" });
    return;
  }
  try {
    const search = await searchYouTube(q, { type: typeParam as SearchType, continuation });
    const base = baseUrl(req);
    const results = search.results.map((r) => {
      if (r.kind === "video") {
        return {
          ...r,
          url: `https://www.youtube.com/watch?v=${r.videoId}`,
          infoUrl: `${base}/api/info?v=${encodeURIComponent(r.videoId)}`,
          /** Best playable track, proxied (VISIONOS returns no muxed track). */
          downloadUrl: `${base}/api/link?v=${encodeURIComponent(r.videoId)}`,
          /** Audio-only, proxied. */
          audioUrl: `${base}/api/link?v=${encodeURIComponent(r.videoId)}&format=audio`,
          /** Everything: formats, direct URLs, proxied links. */
          linkUrl: `${base}/api/link?v=${encodeURIComponent(r.videoId)}`,
        };
      }
      if (r.kind === "playlist") {
        return { ...r, url: `https://www.youtube.com/playlist?list=${r.playlistId}` };
      }
      return { ...r, url: `https://www.youtube.com/channel/${r.channelId}` };
    });

    res.json({
      ok: true,
      query: search.query,
      type: search.type,
      count: results.length,
      continuation: search.continuation ?? null,
      results,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

/**
 * GET /api/link?v=<id|url>[&itag=][&quality=best|1080|720|360][&format=]
 * Returns a single best-matching download link.
 */
app.get("/api/link", async (req: Request, res: Response) => {
  const input = String(req.query.v ?? req.query.url ?? req.query.id ?? "").trim();
  if (!input) {
    res.status(400).json({ ok: false, error: "missing query param: v (video id or URL)" });
    return;
  }
  try {
    const info = await getVideoInfo(input);
    const base = baseUrl(req);
    const itag = req.query.itag ? Number(req.query.itag) : undefined;
    const wantKind = req.query.format ? String(req.query.format) : "video";
    const quality = String(req.query.quality ?? "best").toLowerCase();

    let candidates = info.formats;
    if (itag) {
      candidates = candidates.filter((f) => f.itag === itag);
    } else {
      const matchKind = wantKind === "any" ? candidates : candidates.filter((f) => f.kind === wantKind);
      // VISIONOS never returns a muxed track, so fall back to the best video-only
      // track when the caller asks for one.
      candidates = matchKind.length > 0 || wantKind !== "muxed" ? matchKind : candidates.filter((f) => f.kind !== "audio");
      if (quality !== "best" && quality !== "worst") {
        const h = Number(quality);
        if (!Number.isNaN(h)) candidates = candidates.filter((f) => !f.height || f.height <= h);
      }
    }
    if (candidates.length === 0) {
      res.status(404).json({ ok: false, error: "no format matched the request" });
      return;
    }
    candidates.sort((a, b) => b.bitrate - a.bitrate);
    const chosen = quality === "worst" ? candidates[candidates.length - 1] : candidates[0];

    // Audio track that pairs with the chosen video (best audio, or lowest for "worst").
    const audio = info.formats
      .filter((f) => f.kind === "audio")
      .sort((a, b) => b.bitrate - a.bitrate);
    const audioChosen = quality === "worst" ? audio[audio.length - 1] : audio[0];

    res.json({
      ok: true,
      video: {
        videoId: info.videoId,
        title: info.title,
        author: info.author,
        lengthSeconds: info.lengthSeconds,
      },
      expiresInSeconds: info.expiresInSeconds,
      selected: {
        video: chosen ? fmtPublic(base, info, chosen) : null,
        audio: chosen?.kind === "muxed" ? null : audioChosen ? fmtPublic(base, info, audioChosen) : null,
      },
      /** Best single link: proxied video (muxed if available). */
      downloadUrl: chosen
        ? `${base}/api/download?v=${encodeURIComponent(info.videoId)}&itag=${chosen.itag}`
        : null,
      directUrl: chosen?.url ?? null,
      audioUrl: chosen?.kind === "muxed" || !audioChosen
        ? null
        : `${base}/api/download?v=${encodeURIComponent(info.videoId)}&itag=${audioChosen.itag}`,
      audioDirectUrl: chosen?.kind === "muxed" || !audioChosen ? null : audioChosen.url,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

/**
 * GET /api/download?v=<id|url>&itag=<itag>
 * Streams the media through the server with Range support (seekable, no CORS
 * problems). Add &dl=1 to force a file download.
 */
app.get("/api/download", async (req: Request, res: Response) => {
  const input = String(req.query.v ?? req.query.url ?? req.query.id ?? "").trim();
  const itag = Number(req.query.itag);
  if (!input || Number.isNaN(itag)) {
    if (wantsHtml(req)) {
      res.type("html").send(renderHome());
      return;
    }
    res.status(400).json({ ok: false, error: "missing query params: v and itag" });
    return;
  }
  try {
    const info = await getVideoInfo(input);
    const fmt = info.formats.find((f) => f.itag === itag);
    if (!fmt) {
      res.status(404).json({ ok: false, error: `itag ${itag} not available` });
      return;
    }
    if (req.query.dl) {
      const ext = fmt.container || (fmt.kind === "audio" ? "m4a" : "mp4");
      const safe = info.title.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || info.videoId;
      res.setHeader("Content-Disposition", `attachment; filename="${safe}_${fmt.quality}_${itag}.${ext}"`);
    }
    await streamMedia(fmt.url, req.headers.range, fmt.contentLength, res, fmt.mimeType, req.method === "HEAD");
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } else {
      res.end();
    }
  }
});

/**
 * Unknown routes: HTML page for browsers, JSON route list for everything else.
 */
app.use((req, res) => {
  if (wantsHtml(req)) {
    res.status(404).type("html").send(renderHome());
    return;
  }
  res.status(404).json({
    ok: false,
    error: "not found",
    routes: [
      "GET /",
      "GET /health",
      "GET /api",
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
      "GET /api/music/radio?id=",
    ],
  });
});

app.listen(config.port, config.host, () => {
  console.log(`vidmate-yt-api listening on http://${config.host}:${config.port}`);
  console.log(`  client : ${config.client.clientName} ${config.client.clientVersion} (name ${config.client.clientNameHeader})`);
  console.log(`  proxy  : ${config.proxy || "direct"}`);
  console.log(`  host   : ${config.hosts[0]}`);
});

export default app;
