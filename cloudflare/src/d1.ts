import { Env } from "./types";

export interface EdgeAuditLog {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string;
  colo?: string;
}

export async function logEdgeAudit(
  env: Env,
  entry: EdgeAuditLog
): Promise<void> {
  if (!env.DB) return;

  try {
    await env.DB.prepare(
      `INSERT INTO edge_audit_logs 
       (actor_id, action, resource_type, resource_id, ip_address, colo, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(
        entry.actorId,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.ipAddress,
        entry.colo || "unknown"
      )
      .run();
  } catch (err) {
    console.error("Failed to write to D1 audit log:", err);
  }
}

export async function checkRateLimit(
  env: Env,
  ip: string,
  limit: number = 60,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.DB) return { allowed: true, remaining: limit };

  const key = `ip:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);

  try {
    const existing = await env.DB.prepare(
      "SELECT count, window_start FROM edge_rate_limits WHERE key = ?"
    )
      .bind(key)
      .first<{ count: number; window_start: number }>();

    if (!existing || existing.window_start < windowStart) {
      await env.DB.prepare(
        "INSERT INTO edge_rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = ?"
      )
        .bind(key, windowStart, windowStart)
        .run();
      return { allowed: true, remaining: limit - 1 };
    }

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    await env.DB.prepare(
      "UPDATE edge_rate_limits SET count = count + 1 WHERE key = ?"
    )
      .bind(key)
      .run();

    return { allowed: true, remaining: limit - (existing.count + 1) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}
