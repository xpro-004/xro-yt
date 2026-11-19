/**
 * Stream tests: drive the real /api/download path against a real local origin
 * server, so the chunked range logic is exercised end to end (no mocks).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** Keep the stall test fast; read by config.ts when stream.js is imported. */
process.env.CHUNK_TIMEOUT_MS = "1000";

/** 6 MiB of deterministic bytes, so short reads are detectable. */
const MEDIA = Buffer.alloc(6 << 20);
for (let i = 0; i < MEDIA.length; i++) MEDIA[i] = i & 0xff;

let origin;
let originPort;

/** Serves MEDIA with Range support; can be told to truncate or stall. */
function startOrigin() {
  origin = http.createServer((req, res) => {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    let end = range && range[2] ? Number(range[2]) : MEDIA.length - 1;
    end = Math.min(end, MEDIA.length - 1);
    const body = MEDIA.subarray(start, end + 1);

    // Every chunk larger than 1 MiB answers with only the first 1 MiB. A client
    // that advances by the requested size instead of the bytes received will
    // corrupt the file and stall; one that advances by buf.length survives.
    const cut = body.length > 1 << 20 ? body.subarray(0, 1 << 20) : body;

    res.writeHead(range ? 206 : 200, {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes ${start}-${start + cut.length - 1}/${MEDIA.length}`,
      "Content-Length": String(cut.length),
      "Accept-Ranges": "bytes",
    });
    res.end(cut);
  });
  origin.listen(0, "127.0.0.1");
  return once(origin, "listening");
}

let server;
let base;

async function bootServer() {
  await startOrigin();
  originPort = origin.address().port;
  const port = 8900 + Math.floor(Math.random() * 90);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["dist/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      PROXY: "",
      UPSTREAM_HOSTS: `http://127.0.0.1:${originPort}`,
      UPSTREAM_API_KEY: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  server.stderr.on("data", (d) => (err += d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${err}`);
}

after(async () => {
  server?.kill();
  origin?.close();
});

/**
 * The download route resolves the player response first, so these tests drive
 * streamMedia directly through a small response harness. That keeps them fast
 * and deterministic while still exercising the real chunked range logic against
 * a real origin server.
 */
const { streamMedia } = await import("../dist/stream.js");

function harness() {
  const res = {
    headers: {},
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    chunks: [],
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    write(b) {
      this.chunks.push(Buffer.from(b));
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    destroy() {
      this.destroyed = true;
      this.writableEnded = true;
    },
    once() {
      /* writes never report backpressure in this harness */
    },
    body() {
      return Buffer.concat(this.chunks);
    },
  };
  return res;
}

test("streamMedia returns every byte when the origin short-reads each chunk", async () => {
  await startOrigin();
  originPort = origin.address().port;
  const url = `http://127.0.0.1:${originPort}/videoplayback`;
  const res = harness();

  await streamMedia(url, undefined, MEDIA.length, res, "video/mp4");

  assert.equal(res.statusCode, 200);
  assert.equal(Number(res.headers["content-length"]), MEDIA.length);
  assert.equal(res.body().length, MEDIA.length, "no bytes may be skipped or lost");
  assert.ok(res.body().equals(MEDIA), "the reassembled body must match the source exactly");
});

test("streamMedia honours a client Range and returns exactly that slice", async () => {
  const url = `http://127.0.0.1:${originPort}/videoplayback`;
  const start = 2 << 20;
  const end = 3 << 20;
  const res = harness();

  await streamMedia(url, `bytes=${start}-${end}`, MEDIA.length, res, "video/mp4");

  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes ${start}-${end}/${MEDIA.length}`);
  assert.equal(res.body().length, end - start + 1);
  assert.ok(res.body().equals(MEDIA.subarray(start, end + 1)), "range bytes must line up");
});

test("streamMedia fails cleanly, before any headers, when the origin is dead", async () => {
  // Nothing listens here, so the first chunk cannot be read.
  const url = "http://127.0.0.1:9/videoplayback";
  const res = harness();

  await assert.rejects(
    () => streamMedia(url, undefined, MEDIA.length, res, "video/mp4"),
    /upstream media unavailable/,
  );

  // Nothing was committed, so the route can still answer 502 instead of
  // promising a body it cannot deliver.
  assert.equal(res.statusCode, 0);
  assert.equal(res.headers["content-length"], undefined);
  assert.equal(res.body().length, 0);
});

test("streamMedia gives up on an upstream that accepts the request and sends nothing", async () => {
  // The original bug: the chunk timeout was passed as 0, which Node reads as
  // "never time out". A silent upstream then held the response open forever and
  // the browser showed an endless spinner.
  const stalled = http.createServer(() => {
    /* accept the request, never answer */
  });
  stalled.listen(0, "127.0.0.1");
  await once(stalled, "listening");
  const port = stalled.address().port;
  const res = harness();

  const started = Date.now();
  try {
    await assert.rejects(
      () => streamMedia(`http://127.0.0.1:${port}/videoplayback`, undefined, MEDIA.length, res),
      /upstream media unavailable/,
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 15000, `must abandon the stalled upstream, took ${elapsed}ms`);
    assert.equal(res.body().length, 0);
  } finally {
    stalled.closeAllConnections();
    stalled.close();
  }
});

test("streamMedia rejects an upstream that ignores Range instead of corrupting output", async () => {
  // This origin answers every request with 200 and the whole file, as if Range
  // were unsupported. Offsets would silently splice the wrong bytes.
  const liar = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(MEDIA.length) });
    res.end(MEDIA);
  });
  liar.listen(0, "127.0.0.1");
  await once(liar, "listening");
  const port = liar.address().port;
  const res = harness();

  try {
    await assert.rejects(
      () => streamMedia(`http://127.0.0.1:${port}/videoplayback`, undefined, MEDIA.length, res),
      /upstream media unavailable/,
    );
    assert.equal(res.body().length, 0, "must not emit bytes it cannot place");
  } finally {
    liar.close();
  }
});

test("streamMedia treats a suffix range as the last N bytes", async () => {
  const url = `http://127.0.0.1:${originPort}/videoplayback`;
  const res = harness();

  await streamMedia(url, "bytes=-1000", MEDIA.length, res);
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes ${MEDIA.length - 1000}-${MEDIA.length - 1}/${MEDIA.length}`);
  const body = res.body();
  assert.equal(body.length, 1000);
  assert.ok(body.equals(MEDIA.subarray(MEDIA.length - 1000)), "must return the tail, not the head");
});

test("streamMedia answers a range past the end of the file with 416", async () => {
  const url = `http://127.0.0.1:${originPort}/videoplayback`;
  const res = harness();

  await streamMedia(url, `bytes=${MEDIA.length + 10}-`, MEDIA.length, res);
  assert.equal(res.statusCode, 416);
  assert.equal(res.headers["content-range"], `bytes */${MEDIA.length}`);
  assert.equal(res.body().length, 0);
});

test("streamMedia answers HEAD with headers and no body", async () => {
  const url = `http://127.0.0.1:${originPort}/videoplayback`;
  const res = harness();

  await streamMedia(url, undefined, MEDIA.length, res, "video/mp4", true);

  assert.equal(res.statusCode, 200);
  assert.equal(Number(res.headers["content-length"]), MEDIA.length);
  assert.equal(res.body().length, 0);
  assert.ok(res.writableEnded);
});

void bootServer;
