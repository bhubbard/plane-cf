export interface Env {
  // Cloudflare Bindings
  DB: D1Database;
  FILES: R2Bucket;
  KV: KVNamespace;
  LIVE_ROOM: DurableObjectNamespace;
  JOBS_QUEUE: Queue<PlaneJobMessage>;
  ASSETS: Fetcher;

  // Environment Variables
  SERVER_NAME: string;
  PLANE_URL: string;
  API_ORIGIN: string;
  BUCKET_NAME: string;
  LIVE_ORIGIN: string;
  USE_DURABLE_OBJECTS_FOR_LIVE: string;
}

export interface PlaneJobMessage {
  type: "webhook" | "email" | "asset_cleanup" | "analytics" | "notification";
  payload: Record<string, unknown>;
  timestamp: string;
  id?: string;
}
