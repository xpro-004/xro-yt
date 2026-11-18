/**
 * Central configuration. Everything is overridable via environment variables so
 * the server can be pointed at a different egress (SOCKS/HTTP proxy) or client.
 */

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",

  /** Upstream API key recovered from the Vidmate APK. */
  apiKey:
    process.env.UPSTREAM_API_KEY ??
    process.env.YT_API_KEY ??
    "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",

  /** Upstream API hosts, tried in order. */
  hosts: (
    process.env.UPSTREAM_HOSTS ??
    process.env.YT_HOSTS ??
    "https://youtubei.googleapis.com"
  ).split(","),

  /**
   * Optional proxy for all outbound traffic, e.g.
   *   socks5://127.0.0.1:40000   (Cloudflare WARP via usque)
   *   socks5://127.0.0.1:40001   (WireGuard via wireproxy)
   * Leave empty for direct.
   */
  proxy: process.env.PROXY ?? process.env.HTTPS_PROXY ?? "",

  /** Request timeout for API calls (ms). */
  timeoutMs: Number(process.env.TIMEOUT_MS ?? 30000),

  /** How many times to retry a player call before giving up. */
  retries: Number(process.env.RETRIES ?? 6),

  /**
   * Client used for the player call.
   *
   * VISIONOS is the key finding: unlike IOS / ANDROID_VR / WEB, it serves the
   * *entire* media file from a flagged/datacenter IP (no ~5% preview cap) and
   * needs no PO token.
   */
  client: {
    clientName: process.env.UPSTREAM_CLIENT_NAME ?? process.env.YT_CLIENT_NAME ?? "VISIONOS",
    clientVersion: process.env.UPSTREAM_CLIENT_VERSION ?? process.env.YT_CLIENT_VERSION ?? "1.02",
    clientNameHeader: process.env.UPSTREAM_CLIENT_HEADER ?? process.env.YT_CLIENT_HEADER ?? "101",
    userAgent:
      process.env.UPSTREAM_USER_AGENT ??
      process.env.YT_USER_AGENT ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    osName: "visionOS",
    osVersion: "1.3.0.22O473",
  },

  /**
   * Client for the YouTube Music catalogue (`music.youtube.com`). WEB_REMIX
   * serves browse/search/next responses with the `music*Renderer` shapes the
   * music routes parse. Keep it separate from `client`: VISIONOS headers must
   * never be sent to the music host.
   */
  music: {
    host: process.env.MUSIC_HOST ?? "https://music.youtube.com",
    apiKey:
      process.env.MUSIC_API_KEY ??
      process.env.YT_MUSIC_API_KEY ??
      "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
    clientName: process.env.MUSIC_CLIENT_NAME ?? "WEB_REMIX",
    clientVersion: process.env.MUSIC_CLIENT_VERSION ?? "1.20261115.14.00",
    clientNameHeader: process.env.MUSIC_CLIENT_HEADER ?? "67",
    userAgent:
      process.env.MUSIC_USER_AGENT ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },
} as const;

export type Config = typeof config;
