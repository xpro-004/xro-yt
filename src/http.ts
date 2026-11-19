import http from "node:http";
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * Minimal HTTPS client. Uses `socks-proxy-agent` when a SOCKS proxy is
 * configured, so all traffic can be routed through WARP / WireGuard.
 */

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

let agentCache: { proxy: string; agent: https.Agent | undefined } | undefined;

function agentFor(proxy: string): https.Agent | undefined {
  if (!proxy) return undefined;
  if (agentCache?.proxy === proxy) return agentCache.agent;
  const agent = new SocksProxyAgent(proxy);
  agentCache = { proxy, agent };
  return agent;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  proxy?: string;
  timeoutMs?: number;
  /** Return the raw stream instead of buffering (used for media downloads). */
  stream?: boolean;
  /** Follow up to N HTTP redirects (googlevideo load-balances via 302). */
  maxRedirects?: number;
}

export function request(
  url: string,
  opts: RequestOptions = {},
): Promise<HttpResponse & { stream?: NodeJS.ReadableStream }> {
  const maxRedirects = opts.maxRedirects ?? 5;
  return new Promise((resolve, reject) => {
    const go = (target: string, left: number) => {
      const u = new URL(target);
      const agent = agentFor(opts.proxy ?? "");
      const transport = u.protocol === "http:" ? http : https;
      const req = transport.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === "http:" ? 80 : 443),
          path: u.pathname + u.search,
          method: opts.method ?? "GET",
          headers: opts.headers,
          agent,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const loc = res.headers.location as string | undefined;
          if (loc && status >= 300 && status < 400 && left > 0) {
            res.resume(); // drain
            const next = new URL(loc, target).toString();
            go(next, left - 1);
            return;
          }
          if (opts.stream) {
            resolve({ status, headers: res.headers, body: Buffer.alloc(0), stream: res });
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      req.on("error", reject);
      // `setTimeout(0)` means "never time out", so a falsy or negative value has
      // to fall back to the default rather than being passed through.
      const timeout = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
      req.setTimeout(timeout, () => req.destroy(new Error(`timeout after ${timeout}ms`)));
      if (opts.body) req.write(opts.body);
      req.end();
    };
    go(url, maxRedirects);
  });
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, opts);
  const text = res.body.toString("utf8");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

