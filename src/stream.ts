import type { Response } from "express";
import { config } from "./config.js";
import { request } from "./http.js";

/**
 * googlevideo serves a media URL reliably only in modest ranges — a single
 * long-lived request tends to stall once it passes ~8-12 MiB — but it will serve
 * any number of small sequential ranges on the same URL. So we page the file in
 * chunks and concatenate them onto the response, while honouring the client's own
 * Range header so seeking works.
 */

const CHUNK = 4 << 20; // 4 MiB
/** Small first chunk: the browser cannot render a frame until bytes arrive. */
const FIRST_CHUNK = 512 << 10; // 512 KiB
const MAX_TRIES = 8;

/**
 * Idle timeout for one chunk. googlevideo sometimes accepts a request and then
 * sends nothing; without a deadline that request pins the response open forever
 * and the client sits on a spinner with no bytes and no error.
 */
const CHUNK_TIMEOUT_MS = config.chunkTimeoutMs;

interface ClientRange {
  start: number;
  end: number;
  partial: boolean;
  /** The header asked for bytes outside the file, which HTTP answers with 416. */
  unsatisfiable?: boolean;
}

function parseRange(header: string | undefined, total: number): ClientRange {
  const whole: ClientRange = { start: 0, end: total - 1, partial: false };
  if (!header) return whole;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return whole;
  const [, s, e] = m;
  // "bytes=-500" is a suffix range: the last 500 bytes, not a range from 0.
  if (!s && e) {
    const want = Number(e);
    if (!Number.isFinite(want) || want <= 0) return { ...whole, partial: true, unsatisfiable: true };
    return { start: Math.max(0, total - want), end: total - 1, partial: true };
  }
  const start = s ? Number(s) : 0;
  let end = e ? Number(e) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return whole;
  if (end >= total) end = total - 1;
  if (start >= total || start > end) return { ...whole, partial: true, unsatisfiable: true };
  return { start, end, partial: true };
}

/**
 * One range request. Returns whatever bytes arrived — possibly fewer than asked
 * for, since googlevideo can cut a response short — or undefined when the
 * request failed or timed out.
 */
async function fetchRange(url: string, start: number, end: number): Promise<Buffer | undefined> {
  try {
    const res = await request(url, {
      headers: { "User-Agent": config.client.userAgent, Range: `bytes=${start}-${end}` },
      proxy: config.proxy,
      timeoutMs: CHUNK_TIMEOUT_MS,
      maxRedirects: 5,
    });
    // We always send a Range, so a 206 is the only response whose body starts at
    // `start`. A 200 means the header was ignored and the body is the whole file
    // from byte 0 — buffering that for an offset would corrupt the output and
    // exhaust memory, so treat it as a failed chunk.
    if (res.status !== 206) return undefined;
    return res.body.length > 0 ? res.body : undefined;
  } catch {
    /* caller retries */
  }
  return undefined;
}

/**
 * One chunk, retried until the budget runs out. Returns undefined only when the
 * chunk could not be read at all. `tries` is lower for the first chunk so a dead
 * upstream fails fast instead of holding the client for the whole budget.
 */
async function fetchChunk(
  url: string,
  start: number,
  end: number,
  tries = MAX_TRIES,
): Promise<Buffer | undefined> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const buf = await fetchRange(url, start, end);
    if (buf) return buf;
    if (attempt < tries) await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  return undefined;
}

export async function streamMedia(
  mediaUrl: string,
  rangeHeader: string | undefined,
  total: number,
  res: Response,
  contentType = "video/mp4",
  headOnly = false,
): Promise<void> {
  // Without a byte count we cannot promise Content-Length, and guessing produces
  // an empty 200 that the browser reports as a silent, unplayable file.
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("upstream did not report a media size");
  }
  const { start, end, partial, unsatisfiable } = parseRange(rangeHeader, total);
  const length = end - start + 1;

  const writeHeaders = () => {
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    if (partial) {
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(length));
      res.status(206);
    } else {
      res.setHeader("Content-Length", String(total));
      res.status(200);
    }
  };

  if (unsatisfiable) {
    res.setHeader("Content-Range", `bytes */${total}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.status(416);
    res.end();
    return;
  }

  if (headOnly) {
    writeHeaders();
    res.end();
    return;
  }

  // Read the first chunk before committing headers. Once Content-Length is on
  // the wire the status is fixed, so a dead upstream would leave the client
  // waiting on a body that never arrives; here it can still become a clean 502.
  const firstEnd = Math.min(start + FIRST_CHUNK - 1, end);
  const first = await fetchChunk(mediaUrl, start, firstEnd, 3);
  if (!first) throw new Error("upstream media unavailable");

  writeHeaders();
  if (!res.write(first)) {
    await new Promise<void>((resolve) => res.once("drain", () => resolve()));
  }

  let pos = start + first.length;
  // Fetch one chunk ahead: a single sequential chain tops out around 1 MB/s
  // because each request pays its own round-trip to googlevideo. Mid-stream
  // chunks still retry, since a single stall would otherwise kill playback.
  let ahead: Promise<Buffer | undefined> | undefined;
  while (pos <= end) {
    if (res.writableEnded || res.destroyed) return;
    const buf = await (ahead ?? fetchChunk(mediaUrl, pos, Math.min(pos + CHUNK - 1, end), 4));
    ahead = undefined;
    if (!buf) {
      // The client already holds part of the body and was promised `length`
      // bytes, so ending cleanly would leave it waiting forever. Dropping the
      // socket surfaces a truncated transfer instead of an endless spinner.
      res.destroy();
      return;
    }
    pos += buf.length;
    if (pos <= end) {
      const nextEnd = Math.min(pos + CHUNK - 1, end);
      ahead = fetchChunk(mediaUrl, pos, nextEnd, 4);
    }
    if (!res.write(buf)) {
      await new Promise<void>((resolve) => res.once("drain", () => resolve()));
    }
  }
  res.end();
}
