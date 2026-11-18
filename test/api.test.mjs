/**
 * End-to-end API tests. Boots the real built server (dist/index.js) and drives it
 * over HTTP — no mocks. Needs network egress to the upstream API; set PROXY to
 * route it through a SOCKS5 proxy (e.g. WARP) when running on a datacenter host.
 *
 *   npm test                      # full suite
 *   PORT=8799 PROXY=socks5://127.0.0.1:40000 npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.TEST_PORT ?? process.env.PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
let child;

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

test("GET /health reports ok and the active client", async () => {
  const { status, body } = await j("/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.client, "client name is reported");
  assert.equal(typeof body.uptimeSeconds, "number");
});

test("GET /api/search returns video results with ready-made links", async () => {
  const { status, body } = await j("/api/search?q=bangla+song&type=video");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.type, "video");
  assert.ok(body.count > 0, "got at least one result");

  const v = body.results.find((r) => r.kind === "video");
  assert.ok(v, "a video result is present");
  assert.match(v.videoId, /^[A-Za-z0-9_-]{11}$/);
  assert.ok(v.title.length > 0, "title");
  assert.ok(v.thumbnail?.startsWith("http"), "thumbnail");
  assert.match(v.downloadUrl, /\/api\/link\?v=/);
  assert.match(v.audioUrl, /format=audio/);
  assert.match(v.infoUrl, /\/api\/info\?v=/);
  assert.equal(typeof v.lengthSeconds, "number");
});

test("GET /api/search pages do not repeat items", async () => {
  const first = (await j("/api/search?q=bangla+song&type=video")).body;
  assert.ok(first.continuation, "page 1 hands back a continuation token");

  const second = (
    await j(`/api/search?q=&type=video&continuation=${encodeURIComponent(first.continuation)}`)
  ).body;
  assert.equal(second.ok, true);
  assert.ok(second.count > 0, "page 2 has results");

  const firstIds = new Set(first.results.map((r) => r.videoId));
  const overlap = second.results.filter((r) => firstIds.has(r.videoId));
  assert.equal(overlap.length, 0, "page 2 must not repeat page 1");
});

test("GET /api/search type=channel returns channel fields", async () => {
  const { body } = await j("/api/search?q=tahsan&type=channel");
  assert.equal(body.ok, true);
  const c = body.results.find((r) => r.kind === "channel");
  assert.ok(c, "a channel result is present");
  assert.ok(c.channelId);
  assert.ok(c.title);
  assert.ok(c.url.includes("/channel/"));
});

test("GET /api/search type=playlist returns playlist fields", async () => {
  const { body } = await j("/api/search?q=bangla+music&type=playlist");
  assert.equal(body.ok, true);
  const p = body.results.find((r) => r.kind === "playlist");
  assert.ok(p, "a playlist result is present");
  assert.ok(p.playlistId);
  assert.ok(p.url.includes("list="));
});

test("GET /api/search type=all mixes result kinds", async () => {
  const { body } = await j("/api/search?q=tahsan&type=all");
  assert.equal(body.ok, true);
  assert.ok(body.count > 0);
});

test("GET /api/search rejects a bad type and a missing query", async () => {
  const badType = await j("/api/search?q=x&type=bogus");
  assert.equal(badType.status, 400);
  assert.equal(badType.body.ok, false);

  const noQuery = await j("/api/search");
  assert.equal(noQuery.status, 400);
  assert.equal(noQuery.body.ok, false);
});

test("GET /api/info lists formats with direct and proxied links", async () => {
  const { body } = await j("/api/info?v=iss_85SWLYA");
  assert.equal(body.ok, true);
  assert.ok(body.count > 0);
  assert.ok(body.video.videoId === "iss_85SWLYA");
  assert.ok(body.video.title.length > 0);

  const video = body.formats.find((f) => f.kind === "video");
  assert.ok(video, "a video-only format is present");
  assert.match(video.directUrl, /^https:/);
  assert.match(video.proxyUrl, /\/api\/download\?v=.*itag=/);
  assert.ok(video.contentLength > 0, "content length known");

  const audio = body.formats.find((f) => f.kind === "audio");
  assert.ok(audio, "an audio-only format is present");
});

test("GET /api/info honours format and maxHeight filters", async () => {
  const { body } = await j("/api/info?v=iss_85SWLYA&format=audio&maxHeight=720");
  assert.equal(body.ok, true);
  assert.ok(body.formats.length > 0);
  assert.ok(body.formats.every((f) => f.kind === "audio"), "only audio rows");
});

test("GET /api/link returns a video link plus its paired audio", async () => {
  const { body } = await j("/api/link?v=iss_85SWLYA&quality=720");
  assert.equal(body.ok, true);
  assert.ok(body.selected.video, "a video track was selected");
  assert.match(body.downloadUrl, /\/api\/download\?v=/);
  assert.ok(body.directUrl.startsWith("https:"));
  assert.ok(body.audioUrl, "a paired audio track is offered");
});

test("GET /api/link format=audio returns an audio link", async () => {
  const { body } = await j("/api/link?v=iss_85SWLYA&format=audio");
  assert.equal(body.ok, true);
  assert.equal(body.selected.video.kind, "audio");
  assert.match(body.downloadUrl, /\/api\/download\?v=/);
});

test("GET /api/link format=muxed falls back to a video track", async () => {
  const { body } = await j("/api/link?v=iss_85SWLYA&format=muxed");
  assert.equal(body.ok, true, "must not error when no muxed track exists");
  assert.ok(body.selected.video, "a track was selected");
  assert.ok(body.downloadUrl);
});

test("GET /api/download supports HEAD and Range", async () => {
  const info = (await j("/api/info?v=iss_85SWLYA")).body;
  const audio = info.formats.find((f) => f.kind === "audio");

  const head = await fetch(`${BASE}/api/download?v=iss_85SWLYA&itag=${audio.itag}`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  assert.ok(Number(head.headers.get("content-length")) > 0);

  const ranged = await fetch(`${BASE}/api/download?v=iss_85SWLYA&itag=${audio.itag}`, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal(ranged.status, 206);
  assert.match(ranged.headers.get("content-range"), /^bytes 0-99\//);
  const buf = Buffer.from(await ranged.arrayBuffer());
  assert.equal(buf.length, 100, "exactly the requested range");
});

test("GET /api/download rejects a missing itag and an unknown itag", async () => {
  const missing = await j("/api/download?v=iss_85SWLYA");
  assert.equal(missing.status, 400);

  const unknown = await j("/api/download?v=iss_85SWLYA&itag=999999");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.ok, false);
});

test("unknown routes return the route list", async () => {
  const { status, body } = await j("/definitely-not-a-route");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.ok(body.routes.includes("GET /api/search?q="), "route list mentions /api/search");
});
