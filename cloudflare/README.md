# Plane on Cloudflare Services

This package provides a Cloudflare-native edge gateway and serverless integrations for **Plane**, replacing heavy Caddy proxy containers and MinIO storage instances with high-performance Cloudflare edge services.

## Architecture

| Plane Component | Traditional Self-Hosted | Cloudflare Edge Stack |
| :--- | :--- | :--- |
| **Reverse Proxy** | Caddy container | **Cloudflare Worker** (Hono + Workers Assets) |
| **File Storage** | MinIO / AWS S3 | **Cloudflare R2** (`plane-files` bucket, zero egress) |
| **Live Collaboration** | Node.js + Redis | **Cloudflare Durable Objects** (`LiveRoomDO`) + WebSockets |
| **Async Queues** | Celery / RabbitMQ | **Cloudflare Queues** (`plane-jobs`) |
| **Edge Cache / Rate Limit** | In-memory / Nginx | **Cloudflare D1 & KV** (`DB`, `KV`) |
| **Database Acceleration** | Direct Postgres | **Cloudflare Hyperdrive** |

## Directory Structure

```
cloudflare/
├── migrations/
│   └── 0001_init.sql         # D1 database schema for edge audit and rate limiting
├── src/
│   ├── index.ts              # Edge Gateway router (Hono) & Workers Assets fallback
│   ├── live.ts               # Durable Object real-time collaboration editor
│   ├── storage.ts            # Cloudflare R2 direct stream & Range byte handling
│   ├── queue.ts              # Cloudflare Queues batch processor
│   ├── d1.ts                 # D1 audit logging & token bucket rate limiter
│   ├── types.ts              # TypeScript environment & binding declarations
│   └── index.test.ts         # Vitest test suite
├── package.json
├── tsconfig.json
└── wrangler.jsonc            # Cloudflare Wrangler configuration
```

## Quick Start

### 1. Prerequisites

- Node.js >= 20
- Cloudflare CLI (`wrangler`): `npm install -g wrangler`
- Authenticated Cloudflare session: `wrangler login`

### 2. Provision Cloudflare Resources

Run the following commands to create your Cloudflare resources:

```bash
# Create R2 bucket for file uploads
npx wrangler r2 bucket create plane-files

# Create D1 database for edge sessions and rate limiting
npx wrangler d1 create plane-db

# Create KV namespace for edge caching
npx wrangler kv namespace create KV --binding KV

# Create Cloudflare Queue for background events
npx wrangler queues create plane-jobs
```

Update your `wrangler.jsonc` with the resulting IDs.

### 3. Apply D1 Database Migrations

```bash
# Local development
npm run d1:migrate:local

# Remote deployment
npm run d1:migrate:remote
```

### 4. Local Development

Start the Cloudflare Worker locally:

```bash
cd cloudflare
npm install
npm run dev
```

The edge router will be running at `http://localhost:8787`.

- Health check: `http://localhost:8787/healthz`
- Edge diagnostics: `http://localhost:8787/api/v1/edge/info`

### 5. Deploy to Cloudflare Network

```bash
npm run deploy
```
