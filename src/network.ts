import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { MAX_ARCHIVE_BYTES } from "./release";

function trustedGithubHost(hostname: string): boolean {
  return (
    hostname === "api.github.com" ||
    hostname === "github.com" ||
    hostname.endsWith(".githubusercontent.com")
  );
}

export async function openTrustedGithubResponse(urlString: string, remainingRedirects = 5): Promise<IncomingMessage> {
  const url = new URL(urlString);
  if (url.protocol !== "https:" || !trustedGithubHost(url.hostname) || url.username || url.password) {
    throw new Error("Untrusted download address.");
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "obsidian-mcp-tunnel",
          Accept: url.hostname === "api.github.com" ? "application/vnd.github+json" : "*/*",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status <= 399 && res.headers.location) {
          res.resume();
          if (remainingRedirects <= 0) {
            reject(new Error("Too many download redirects."));
            return;
          }
          const redirect = new URL(res.headers.location, url).toString();
          resolve(openTrustedGithubResponse(redirect, remainingRedirects - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error("GitHub request failed (HTTP " + status + ")."));
          return;
        }
        resolve(res);
      },
    );
    req.setTimeout(20_000, () => req.destroy(new Error("GitHub request timed out.")));
    req.on("error", reject);
    req.end();
  });
}

export async function readGithubJson(url: string): Promise<unknown> {
  const response = await openTrustedGithubResponse(url);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    const part = Buffer.from(chunk as Buffer);
    bytes += part.length;
    if (bytes > 1024 * 1024) throw new Error("Release metadata is unexpectedly large.");
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function downloadVerifiedZip(
  url: string,
  destination: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<void> {
  const response = await openTrustedGithubResponse(url);
  const digest = createHash("sha256");
  let received = 0;
  const hashStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_ARCHIVE_BYTES || received > expectedSize) {
        callback(new Error("Archive exceeds the published size."));
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(response, hashStream, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  if (received !== expectedSize || digest.digest("hex") !== expectedSha256) {
    throw new Error("Archive checksum or size does not match the official release.");
  }
}

/** TCP/HTTP probes never contact external hosts or perform MCP operations. */
export async function probeLocalHttp(
  url: URL,
  timeoutMs = 1500,
  headers: Record<string, string> = {},
): Promise<number | null> {
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  return new Promise((resolve) => {
    const req = httpRequest(url, { method: "GET", timeout: timeoutMs, headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? null);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}
