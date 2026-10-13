-- Migration 0001: Initial edge tables for Plane on Cloudflare

-- Edge Audit Logs table
CREATE TABLE IF NOT EXISTS edge_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    colo TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Edge Rate Limiting table
CREATE TABLE IF NOT EXISTS edge_rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL
);

-- Edge Sessions Cache table
CREATE TABLE IF NOT EXISTS edge_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

-- Indices for rapid edge lookups
CREATE INDEX IF NOT EXISTS idx_audit_created ON edge_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON edge_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON edge_sessions(expires_at);
