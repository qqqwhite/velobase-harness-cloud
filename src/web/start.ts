/**
 * Web (Next.js) Service Starter
 *
 * Provides `startWeb()` for the SERVICE_MODE=all combined process.
 *
 * In split deployment (SERVICE_MODE=web), the standalone `server.js` generated
 * by `next build` is run directly (`node .next/standalone/server.js`), which
 * is more efficient. This module is only used when Next.js needs to be started
 * programmatically alongside the API and Worker services.
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("web");

const DEFAULT_WEB_PORT = 3000;

export interface WebHandle {
  shutdown: () => Promise<void>;
}

export async function startWeb(): Promise<WebHandle> {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_WEB_PORT), 10);
  // HOSTNAME is reserved by K8s (set to pod name) — never use it for binding
  const hostname = process.env.WEB_HOST ?? "0.0.0.0";

  // Dynamic import to avoid loading Next.js when not needed
  const next = (await import("next")).default;
  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const { createServer } = await import("http");
  const server = createServer((req, res) => {
    void handle(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, hostname, () => {
      log.info({ port, hostname }, `Next.js server listening on port ${port}`);
      resolve();
    });
  });

  const shutdown = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          log.error({ error: err }, "Error closing Next.js server");
          reject(err);
        } else {
          log.info("Next.js server closed");
          resolve();
        }
      });
    });

  return { shutdown };
}
