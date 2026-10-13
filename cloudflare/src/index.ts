import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { Env, PlaneJobMessage } from "./types";
import { handleR2Get, handleR2Put, handleR2Delete } from "./storage";
import { handleQueue } from "./queue";
import { logEdgeAudit, checkRateLimit } from "./d1";

export { LiveRoomDO } from "./live";

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Range",
      "If-Match",
      "If-None-Match",
      "If-Modified-Since",
      "If-Unmodified-Since",
      "Sec-WebSocket-Protocol",
      "Sec-WebSocket-Key",
      "Sec-WebSocket-Version",
      "X-Workspace-Slug",
    ],
    exposeHeaders: [
      "Content-Length",
      "Content-Range",
      "ETag",
      "Accept-Ranges",
      "Date",
      "X-Plane-Edge-Colo",
    ],
    maxAge: 86400,
    credentials: true,
  })
);

// Edge Health check
app.get("/healthz", (c) => {
  const colo = (c.req.raw as Request & { cf?: { colo?: string } }).cf?.colo || "local";
  return c.json({
    status: "healthy",
    name: c.env.SERVER_NAME || "Plane Cloudflare Edition",
    version: "1.4.2",
    edge: true,
    colo,
    timestamp: new Date().toISOString(),
  });
});

// Edge Info & Diagnostics
app.get("/api/v1/edge/info", (c) => {
  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf || {};
  return c.json({
    server: c.env.SERVER_NAME || "Plane Cloudflare Edition",
    colo: cf.colo || "dev",
    country: cf.country || "unknown",
    city: cf.city || "unknown",
    httpProtocol: cf.httpProtocol || "unknown",
    bindings: {
      d1: !!c.env.DB,
      r2: !!c.env.FILES,
      kv: !!c.env.KV,
      durableObjects: !!c.env.LIVE_ROOM,
      queues: !!c.env.JOBS_QUEUE,
      assets: !!c.env.ASSETS,
    },
  });
});

// Cloudflare R2 Direct Storage Proxy for uploads / assets
app.all("/:bucket/*", async (c) => {
  const bucketName = c.req.param("bucket");
  const targetBucket = c.env.BUCKET_NAME || "plane-files";

  if (bucketName !== targetBucket && bucketName !== "uploads") {
    return c.notFound();
  }

  const url = new URL(c.req.url);
  // Extract key after bucket name
  const prefix = `/${bucketName}/`;
  const key = url.pathname.slice(prefix.length);

  if (c.req.method === "GET" || c.req.method === "HEAD") {
    return handleR2Get(key, c.req.raw, c.env);
  } else if (c.req.method === "PUT") {
    return handleR2Put(key, c.req.raw, c.env);
  } else if (c.req.method === "DELETE") {
    return handleR2Delete(key, c.env);
  }

  return c.text("Method Not Allowed", 405);
});

// Direct assets route
app.all("/assets/v1/*", async (c) => {
  const url = new URL(c.req.url);
  const key = url.pathname.replace(/^\/assets\/v1\//, "");

  if (c.req.method === "GET" || c.req.method === "HEAD") {
    return handleR2Get(key, c.req.raw, c.env);
  } else if (c.req.method === "PUT") {
    return handleR2Put(key, c.req.raw, c.env);
  } else if (c.req.method === "DELETE") {
    return handleR2Delete(key, c.env);
  }

  return c.text("Method Not Allowed", 405);
});

// Durable Objects Collaborative Live Editor WebSocket Handler
app.all("/live/*", async (c) => {
  const url = new URL(c.req.url);
  const isWebSocket = c.req.header("Upgrade")?.toLowerCase() === "websocket";

  // Use Cloudflare Durable Objects if enabled
  if (c.env.USE_DURABLE_OBJECTS_FOR_LIVE === "true" && c.env.LIVE_ROOM) {
    // Room ID derived from URL path (e.g. /live/room/:roomId or query /live/?room=xyz)
    const roomId =
      url.pathname.replace(/^\/live\/(room\/)?/, "") ||
      url.searchParams.get("room") ||
      "default-live-room";

    const id = c.env.LIVE_ROOM.idFromName(roomId);
    const stub = c.env.LIVE_ROOM.get(id);

    return stub.fetch(c.req.raw);
  }

  // Fallback: proxy to upstream Live server
  const liveOrigin = c.env.LIVE_ORIGIN || "http://localhost:3100";
  const targetUrl = new URL(url.pathname + url.search, liveOrigin);

  const proxyHeaders = new Headers(c.req.raw.headers);
  proxyHeaders.set("X-Forwarded-Host", url.host);
  proxyHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));

  return fetch(targetUrl.toString(), {
    method: c.req.method,
    headers: proxyHeaders,
    body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
    redirect: "manual",
  });
});

// Push Job to Cloudflare Queue
app.post("/api/edge/queue/publish", async (c) => {
  if (!c.env.JOBS_QUEUE) {
    return c.json({ error: "Cloudflare Queue binding not configured" }, 500);
  }

  try {
    const body = (await c.req.json()) as PlaneJobMessage;
    await c.env.JOBS_QUEUE.send({
      type: body.type || "notification",
      payload: body.payload || {},
      timestamp: new Date().toISOString(),
      id: crypto.randomUUID(),
    });

    return c.json({ success: true, enqueued: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: errorMsg }, 400);
  }
});

// Forward API, Auth, and Static routes to Backend API origin
const forwardToApi = async (c: any) => {
  const apiOrigin = c.env.API_ORIGIN || "http://localhost:8000";
  const url = new URL(c.req.url);
  const targetUrl = new URL(url.pathname + url.search, apiOrigin);

  const clientIp = c.req.header("CF-Connecting-IP") || "127.0.0.1";

  // Edge rate limiting check
  if (url.pathname.startsWith("/auth/")) {
    const { allowed, remaining } = await checkRateLimit(c.env, clientIp, 20, 60);
    if (!allowed) {
      return c.json({ error: "Rate limit exceeded. Please wait a moment." }, 429);
    }
  }

  const proxyHeaders = new Headers(c.req.raw.headers);
  proxyHeaders.set("X-Forwarded-Host", url.host);
  proxyHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  proxyHeaders.set("X-Real-IP", clientIp);
  proxyHeaders.set("CF-Connecting-IP", clientIp);

  const response = await fetch(targetUrl.toString(), {
    method: c.req.method,
    headers: proxyHeaders,
    body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
    redirect: "manual",
  });

  const responseHeaders = new Headers(response.headers);
  const colo = (c.req.raw as Request & { cf?: { colo?: string } }).cf?.colo;
  if (colo) {
    responseHeaders.set("X-Plane-Edge-Colo", colo);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

app.all("/api/*", forwardToApi);
app.all("/auth/*", forwardToApi);
app.all("/static/*", forwardToApi);

// Cloudflare Workers Static Assets & Single Page Application fallback
app.all("*", async (c) => {
  if (c.env.ASSETS) {
    try {
      const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // If 404 and requesting an HTML / page route, fallback to index.html for SPA routing
      const accept = c.req.header("Accept") || "";
      if (accept.includes("text/html") || !accept.includes(".")) {
        const url = new URL(c.req.url);
        // Map sub-apps to their respective root index.html if partitioned
        let indexPath = "/index.html";
        if (url.pathname.startsWith("/god-mode")) {
          indexPath = "/god-mode/index.html";
        } else if (url.pathname.startsWith("/spaces")) {
          indexPath = "/spaces/index.html";
        }

        const fallbackRequest = new Request(new URL(indexPath, url.origin), c.req.raw);
        const fallbackResponse = await c.env.ASSETS.fetch(fallbackRequest);
        if (fallbackResponse.status === 200) {
          return fallbackResponse;
        }
      }

      return assetResponse;
    } catch {
      // Continue to fallback
    }
  }

  // In development without ASSETS binding, provide helpful welcome page
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Plane on Cloudflare</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0c0e; color: #f4f5f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #16181d; border: 1px solid #282a36; border-radius: 12px; padding: 36px; max-width: 620px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h1 { margin: 0 0 12px; color: #fff; font-size: 26px; }
          p { color: #9aa0a6; line-height: 1.6; margin: 8px 0 16px; }
          .badge { display: inline-block; background: #f38020; color: #000; font-weight: 600; padding: 4px 10px; border-radius: 20px; font-size: 12px; margin-bottom: 16px; }
          .services { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px; }
          .service-item { background: #1f2229; padding: 12px; border-radius: 8px; border: 1px solid #303440; }
          .service-item h4 { margin: 0 0 4px; font-size: 14px; color: #3b82f6; }
          .service-item p { margin: 0; font-size: 12px; color: #71767b; }
          code { background: #282a36; padding: 2px 6px; border-radius: 4px; color: #f38020; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">Cloudflare Edge Architecture</span>
          <h1>Plane on Cloudflare Services</h1>
          <p>Welcome to the Cloudflare-native distribution of <strong>Plane</strong>. This edge gateway replaces legacy Caddy reverse proxy containers with native Cloudflare Workers, Durable Objects, R2, D1, and Queues.</p>
          <div class="services">
            <div class="service-item">
              <h4>Cloudflare Workers</h4>
              <p>Global edge proxy & routing</p>
            </div>
            <div class="service-item">
              <h4>Cloudflare R2</h4>
              <p>Zero-egress S3 object storage</p>
            </div>
            <div class="service-item">
              <h4>Durable Objects</h4>
              <p>Real-time collaborative live editor</p>
            </div>
            <div class="service-item">
              <h4>Cloudflare D1 & KV</h4>
              <p>Serverless edge database & cache</p>
            </div>
          </div>
          <p style="margin-top: 24px; font-size: 13px;">API endpoints active at <code>/api/*</code> and health check at <code>/healthz</code>.</p>
        </div>
      </body>
    </html>
  `);
});

export default {
  fetch: app.fetch,
  queue: handleQueue,
};
