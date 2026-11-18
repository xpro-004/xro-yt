/**
 * `/api/music/*` — YouTube Music catalogue endpoints. Thin HTTP layer over
 * `src/music.ts`; every handler follows the repo error contract (400 bad input,
 * 404 no match, 502 upstream failure) and returns `ok`.
 */
import { Router, type Request, type Response } from "express";
import { config } from "./config.js";
import { getVideoInfo } from "./innertube.js";
import {
  musicAlbum,
  musicArtist,
  musicArtistSongs,
  musicHome,
  musicLyrics,
  musicPlaylist,
  musicRadio,
  musicSearch,
  musicTrending,
  parseMusicId,
  type MusicSearchType,
} from "./music.js";

const SEARCH_TYPES: MusicSearchType[] = ["songs", "videos", "albums", "artists", "playlists"];

export const musicRouter = Router();

/** Run a handler, mapping thrown errors onto the repo error contract. */
async function guard(res: Response, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
    } else {
      res.end();
    }
  }
}

/** Required query param, or send 400 and return undefined. */
function need(res: Response, value: unknown, name: string): string | undefined {
  const v = String(value ?? "").trim();
  if (!v) {
    res.status(400).json({ ok: false, error: `missing query param: ${name}` });
    return undefined;
  }
  return v;
}

const musicHealth = () => ({
  client: config.music.clientName,
  clientVersion: config.music.clientVersion,
  host: config.music.host,
});

musicRouter.get("/search", (req: Request, res: Response) =>
  guard(res, async () => {
    const type = String(req.query.type ?? "songs").toLowerCase() as MusicSearchType;
    if (!SEARCH_TYPES.includes(type)) {
      res.status(400).json({ ok: false, error: `invalid type; use ${SEARCH_TYPES.join("|")}` });
      return;
    }
    const continuation = req.query.continuation ? String(req.query.continuation) : undefined;
    const q = String(req.query.q ?? req.query.query ?? "").trim();
    if (!q && !continuation) {
      res.status(400).json({ ok: false, error: "missing query param: q" });
      return;
    }
    const out = await musicSearch(q, type, continuation);
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);

musicRouter.get("/home", (_req: Request, res: Response) =>
  guard(res, async () => {
    const out = await musicHome();
    res.json({ ok: true, ...musicHealth(), count: out.shelves.length, shelves: out.shelves });
  }),
);

musicRouter.get("/artist", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.channelId, "id");
    if (!id) return;
    const out = await musicArtist(parseMusicId(id));
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);

musicRouter.get("/artist/songs", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.channelId, "id");
    if (!id) return;
    const out = await musicArtistSongs(parseMusicId(id));
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);

musicRouter.get("/album", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.browseId, "id");
    if (!id) return;
    const out = await musicAlbum(parseMusicId(id));
    if (out.items.length === 0) {
      res.status(404).json({ ok: false, error: `no album found for ${id}` });
      return;
    }
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);

musicRouter.get("/playlist", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.list, "id");
    if (!id) return;
    const continuation = req.query.continuation ? String(req.query.continuation) : undefined;
    const out = await musicPlaylist(parseMusicId(id), continuation);
    if (out.items.length === 0 && !out.continuation) {
      res.status(404).json({ ok: false, error: `no playlist found for ${id}` });
      return;
    }
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);

musicRouter.get("/trending", (_req: Request, res: Response) =>
  guard(res, async () => {
    const out = await musicTrending();
    res.json({ ok: true, ...musicHealth(), count: out.shelves.length, shelves: out.shelves });
  }),
);

musicRouter.get("/radio", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.v, "id");
    if (!id) return;
    const continuation = req.query.continuation ? String(req.query.continuation) : undefined;
    const out = await musicRadio(parseMusicId(id), continuation);
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);

musicRouter.get("/song", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.v, "id");
    if (!id) return;
    const info = await getVideoInfo(id);
    const base = `${(req.headers["x-forwarded-proto"] as string) ?? req.protocol}://${req.get("host")}`;
    const vid = encodeURIComponent(info.videoId);
    res.json({
      ok: true,
      ...musicHealth(),
      song: {
        videoId: info.videoId,
        title: info.title,
        artist: info.author,
        lengthSeconds: info.lengthSeconds,
        viewCount: info.viewCount,
        thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
      },
      expiresInSeconds: info.expiresInSeconds,
      formatCount: info.formats.length,
      links: {
        info: `${base}/api/info?v=${vid}`,
        download: `${base}/api/link?v=${vid}&format=audio`,
      },
    });
  }),
);

musicRouter.get("/lyrics", (req: Request, res: Response) =>
  guard(res, async () => {
    const id = need(res, req.query.id ?? req.query.v, "id");
    if (!id) return;
    const out = await musicLyrics(parseMusicId(id));
    if (!out.browseId) {
      res.status(404).json({ ok: false, error: "no lyrics available for this track" });
      return;
    }
    res.json({ ok: true, ...musicHealth(), ...out });
  }),
);
