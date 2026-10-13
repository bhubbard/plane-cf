import { Env, PlaneJobMessage } from "./types";

export async function handleQueue(
  batch: MessageBatch<PlaneJobMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;

    try {
      switch (job.type) {
        case "webhook": {
          const targetUrl = job.payload.target_url as string;
          if (targetUrl) {
            await fetch(targetUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "Plane-Cloudflare-Webhook/1.4.2",
              },
              body: JSON.stringify(job.payload),
            });
          }
          break;
        }

        case "asset_cleanup": {
          const keys = job.payload.keys as string[];
          if (Array.isArray(keys)) {
            await env.FILES.delete(keys);
          }
          break;
        }

        case "email":
        case "notification":
        case "analytics":
        default: {
          // Forward event to backend API or log in D1 audit trail
          if (env.DB) {
            await env.DB.prepare(
              "INSERT INTO edge_audit_logs (actor_id, action, resource_type, resource_id, ip_address, colo, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
            )
              .bind(
                (job.payload.actor_id as string) || "system",
                job.type,
                (job.payload.resource_type as string) || "job",
                job.id || "unknown",
                "queue-worker",
                "global"
              )
              .run();
          }
          break;
        }
      }

      message.ack();
    } catch (err) {
      console.error(`Failed to process queue job ${job.id || job.type}:`, err);
      message.retry();
    }
  }
}
