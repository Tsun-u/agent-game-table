import type { IncomingMessage } from "node:http";

/** 反向代理（Cloudflare）後面的真實來源位址；沒有代理就用 socket 位址。 */
export function clientAddress(request: IncomingMessage): string {
  const cloudflare = request.headers["cf-connecting-ip"];
  if (typeof cloudflare === "string" && cloudflare.trim()) return cloudflare.trim();
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]!.trim();
  return request.socket.remoteAddress ?? "unknown";
}
