/**
 * End-to-end tests for the YouTube Music catalogue (`/api/music/*`) and the
 * upstream-API catalogue (`/api`). Boots the real built server and drives it
 * over HTTP — no mocks. Needs network egress; set PROXY to route through a
 * SOCKS5 proxy (e.g. WARP) when running on a datacenter host.
 *
 *   npm test
 *   PORT=8798 PROXY=socks5://127.0.0.1:40000 npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.MUSIC_TEST_PORT ?? process.env.PORT ?? 8798);
const BASE = `http://127.0.0.1:${PORT}`;
let child;

// Stable fixtures: a Bollywood track/artist/album/playlist known to resolve.
const SONG = "W0DM5lcj6mw";
const ARTIST = "UCDxKh1gFWeYsqePvgVzmPoQ";
const ALBUM = "MPREb_p9UzAek29Dn";
const PLAYLIST = "PL2WAE39ngDYNsU2pAE6Vv6Cwlp_Sjp_lc";

const j = async (path, init) => {
  const res = await fetch(BASE + path, init);
  const body = await res.json();
  return { status: res.status, body };
};

before(async () => {
  child = spawn("node", ["dist/index.js"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("server did not become healthy in 30s");
    await sleep(300);
  }
});

after(() => {
  if (child && !child.killed) child.kill("SIGTERM");
});

test("GET /health reports the music client", async () => {
  const { status, body } = await j("/health");
  assert.equal(status, 200);
  assert.equal(body.client, "VISIONOS");
  assert.ok(body.musicClient, "music client is reported");
});

test("GET /api lists every upstream API used", async () => {
  const { status, body } = await j("/api");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.apis) && body.apis.length >= 5);
  const ids = body.apis.map((a) => a.id);
  for (const want of ["visitor_id", "player", "search", "music_search", "music_browse", "music_next"]) {
    assert.ok(ids.includes(want), `catalog mentions ${want}`);
  }
  for (const a of body.apis) {
    assert.ok(a.host && a.path && a.client, `${a.id} has host/path/client`);
    assert.equal(typeof a.requiresProxy, "boolean");
    assert.ok(Array.isArray(a.usedBy) && a.usedBy.length > 0, `${a.id} lists usedBy routes`);
  }
});

test("GET /api/info returns the site API reference", async () => {
  const { status, body } = await j("/api/info?json");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.routes) && body.routes.length >= 15, "documents every route");
  assert.ok(Array.isArray(body.apis) && body.apis.length >= 5, "lists the upstream APIs");
  assert.ok(body.conventions && body.conventions.success, "states the response contract");
  assert.ok(Array.isArray(body.recipes) && body.recipes.length >= 3, "gives worked recipes");

  const paths = body.routes.map((r) => r.path);
  for (const want of ["/api/search", "/api/video", "/api/link", "/api/download", "/api/music/search"]) {
    assert.ok(paths.includes(want), `docs mention ${want}`);
  }
  for (const r of body.routes) {
    assert.ok(r.summary && r.example && r.returns, `${r.path} is described`);
    assert.ok(Array.isArray(r.params), `${r.path} lists params`);
    assert.ok(["Meta", "Video", "Music"].includes(r.group), `${r.path} has a group`);
    // Every JSON route ships a real example response so a client author can see
    // the shape without calling it.
    if (r.returns === "JSON") assert.ok(r.response, `${r.path} carries a sample response`);
  }
});

test("GET /api/info renders a page for browsers and JSON with ?json", async () => {
  const page = await fetch(`${BASE}/api/info`, { headers: { accept: "text/html" } });
  assert.match(page.headers.get("content-type"), /text\/html/);
  const html = await page.text();
  assert.match(html, /vidmate-yt-api/);
  assert.match(html, /GET \/api\/video/, "the page lists routes");

  const json = await fetch(`${BASE}/api/info?json`, { headers: { accept: "text/html" } });
  assert.match(json.headers.get("content-type"), /application\/json/);
});

test("GET /api/music/search returns songs and albums", async () => {
  for (const type of ["songs", "albums"]) {
    const { status, body } = await j(`/api/music/search?q=believer&type=${type}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.type, type);
    assert.ok(body.count > 0, `${type}: got results`);
    const item = body.results[0];
    assert.ok(item.title.length > 0, `${type}: title`);
    assert.ok(item.kind, `${type}: kind`);
  }
});

test("GET /api/music/search rejects a bad type and a missing query", async () => {
  assert.equal((await j("/api/music/search?q=x&type=bogus")).status, 400);
  assert.equal((await j("/api/music/search")).status, 400);
});

test("GET /api/music/home returns shelves", async () => {
  const { status, body } = await j("/api/music/home");
  assert.equal(status, 200);
  assert.ok(body.count > 0, "at least one shelf");
  assert.ok(body.shelves[0].items.length > 0, "first shelf has items");
});

test("GET /api/music/artist returns top songs and shelves", async () => {
  const { status, body } = await j(`/api/music/artist?id=${ARTIST}`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.artist?.title, "artist header present");
  assert.ok(body.topSongs.length > 0, "top songs present");
  assert.ok(body.topSongs[0].videoId, "top song has a videoId");
  assert.ok(body.shelves.length > 1, "several shelves");
});

test("GET /api/music/artist/songs returns a song list", async () => {
  const { status, body } = await j(`/api/music/artist/songs?id=${ARTIST}`);
  assert.equal(status, 200);
  assert.ok(body.items.length > 0, "artist songs present");
});

test("GET /api/music/album returns tracks", async () => {
  const { status, body } = await j(`/api/music/album?id=${ALBUM}`);
  assert.equal(status, 200);
  assert.ok(body.items.length > 0, "album has tracks");
  assert.ok(body.items[0].videoId, "track has a videoId");
});

test("GET /api/music/album 404s for an unknown id", async () => {
  const { status, body } = await j("/api/music/album?id=MPREb_zzzzzzzzzzz");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("GET /api/music/playlist returns tracks and pages", async () => {
  const { status, body } = await j(`/api/music/playlist?id=${PLAYLIST}`);
  assert.equal(status, 200);
  assert.ok(body.items.length > 0, "playlist has tracks");
  assert.ok(body.items[0].videoId, "track has a videoId");
  if (body.continuation) {
    const next = await j(`/api/music/playlist?id=${PLAYLIST}&continuation=${encodeURIComponent(body.continuation)}`);
    assert.equal(next.status, 200);
    assert.ok(next.body.items.length > 0, "next page has tracks");
  }
});

test("GET /api/music/trending returns chart shelves", async () => {
  const { status, body } = await j("/api/music/trending");
  assert.equal(status, 200);
  assert.ok(body.count > 0, "trending shelves present");
  const total = body.shelves.reduce((n, s) => n + s.items.length, 0);
  assert.ok(total > 0, "trending shelves have items");
});

test("GET /api/music/radio returns a queue", async () => {
  const { status, body } = await j(`/api/music/radio?id=${SONG}`);
  assert.equal(status, 200);
  assert.ok(body.items.length > 0, "radio queue has items");
  assert.ok(body.items[0].videoId, "queue row has a videoId");
});

test("GET /api/music/lyrics returns lyric text", async () => {
  const { status, body } = await j(`/api/music/lyrics?id=${SONG}`);
  assert.equal(status, 200);
  assert.ok(body.browseId?.startsWith("MPLYt"), "lyrics browse id");
  assert.ok(typeof body.lyrics === "string" && body.lyrics.length > 20, "lyric text present");
});

test("GET /api/music/song returns metadata plus links", async () => {
  const { status, body } = await j(`/api/music/song?id=${SONG}`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.song.videoId, SONG);
  assert.ok(body.song.title.length > 0, "song title");
  assert.match(body.links.download, /\/api\/link\?v=/);
});

test("music routes reject a missing id", async () => {
  for (const path of ["/api/music/artist", "/api/music/album", "/api/music/playlist", "/api/music/song", "/api/music/radio"]) {
    const { status } = await j(path);
    assert.equal(status, 400, `${path} needs an id`);
  }
});

test("unknown routes list the music endpoints", async () => {
  const { status, body } = await j("/definitely-not-a-route");
  assert.equal(status, 404);
  assert.ok(body.routes.includes("GET /api/music/search?q=&type="));
  assert.ok(body.routes.includes("GET /api"));
});
