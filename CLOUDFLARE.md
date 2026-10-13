# Plane on Cloudflare Services

This fork of [makeplane/plane](https://github.com/makeplane/plane) adapts Plane to run natively with Cloudflare's serverless edge infrastructure.

```mermaid
flowchart TD
    Client["Client / Browser"]
    
    subgraph CF["Cloudflare Global Network"]
        Worker["Cloudflare Worker (Edge Gateway)"]
        Assets["Workers Static Assets (SPA)"]
        DO["Durable Objects (Live Collaboration)"]
        R2["Cloudflare R2 (Object Storage)"]
        D1["Cloudflare D1 (Edge Database)"]
        KV["Cloudflare KV (Session / Cache)"]
        Queue["Cloudflare Queues (Background Jobs)"]
        HD["Cloudflare Hyperdrive (Postgres Acceleration)"]
    end
    
    subgraph Backend["Plane Backend Services"]
        API["Plane Django API"]
        Celery["Background Workers"]
        PG["PostgreSQL Database"]
    end

    Client -->|HTTP / WebSocket| Worker
    Worker -->|/*, /god-mode/*, /spaces/*| Assets
    Worker -->|/live/* WebSocket| DO
    Worker -->|/:bucket/*, /assets/v1/*| R2
    Worker -->|Rate limiting & audit| D1
    Worker -->|Edge session & flags| KV
    Worker -->|Async tasks| Queue
    Worker -->|/api/*, /auth/*, /static/*| API
    
    API -->|S3 API (Zero Egress)| R2
    API -->|Connection Pool & Edge Cache| HD
    HD --> PG
    Queue -->|Async Event Processing| API
```

---

## 🌟 Why Cloudflare for Plane?

1. **Zero Egress Storage with Cloudflare R2**:
   - Replaces heavy, maintenance-heavy local MinIO or expensive AWS S3 storage with Cloudflare R2.
   - 100% S3-compatible API used directly by Plane's Django backend and edge-cached directly by the Worker.
2. **Real-time Live Collaboration with Durable Objects**:
   - Plane's collaborative text editor (Hocuspocus / Yjs) uses WebSocket rooms.
   - Cloudflare Durable Objects (`LiveRoomDO`) provide single-threaded transactional consistency per document room with SQLite persistence and hibernatable WebSockets.
3. **Serverless Edge Gateway replacing Caddy**:
   - High-performance Hono-based router in `cloudflare/src/index.ts` replaces the Dockerized Caddy proxy.
   - Built-in CORS, DDoS mitigation, and edge rate limiting using Cloudflare D1.
4. **Database Acceleration with Hyperdrive**:
   - Caches PostgreSQL queries across 300+ data centers and maintains a persistent connection pool, speeding up Django queries globally.
5. **Background Events with Cloudflare Queues**:
   - Decoupled asynchronous event processing for webhooks and notification dispatch.

---

## 📁 Repository Additions

- [`cloudflare/`](file:///Users/bhubbard/PROJECTS/plane-cf/cloudflare):
  - `wrangler.jsonc`: Cloudflare configuration with bindings for D1, R2, KV, Durable Objects, Queues, and Assets.
  - `package.json` & `tsconfig.json`: TypeScript package with test scripts.
  - `src/index.ts`: Hono edge router and reverse proxy.
  - `src/live.ts`: `LiveRoomDO` Durable Object for collaborative live editor.
  - `src/storage.ts`: R2 streaming, range-request, and caching handlers.
  - `src/queue.ts`: Queue consumer for asynchronous jobs.
  - `src/d1.ts`: D1 rate limiting and audit logging helpers.
  - `migrations/0001_init.sql`: D1 database migration for sessions, rate limits, and audit trail.
- [`deployments/cloudflare/`](file:///Users/bhubbard/PROJECTS/plane-cf/deployments/cloudflare):
  - `docker-compose.cloudflare.yml`: Streamlined Docker Compose removing MinIO and Caddy.
  - `variables.cloudflare.env`: Environment configuration for Cloudflare R2 and Hyperdrive.

---

## 🚀 Getting Started

### 1. Provision Cloudflare Resources

```bash
# Authenticate
npx wrangler login

# Create R2 Bucket
npx wrangler r2 bucket create plane-files

# Create D1 Database
npx wrangler d1 create plane-db

# Create KV Namespace
npx wrangler kv namespace create KV --binding KV

# Create Queue
npx wrangler queues create plane-jobs
```

### 2. Configure Environment

Copy `deployments/cloudflare/variables.cloudflare.env` and update:
- `AWS_S3_ENDPOINT_URL`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `AWS_S3_BUCKET_NAME`: `plane-files`
- `AWS_ACCESS_KEY_ID`: Cloudflare R2 API token key ID
- `AWS_SECRET_ACCESS_KEY`: Cloudflare R2 API token secret

### 3. Run Backend Stack

```bash
cd deployments/cloudflare
docker compose -f docker-compose.cloudflare.yml --env-file variables.cloudflare.env up -d
```

### 4. Run Edge Worker

```bash
cd cloudflare
npm install
npm run d1:migrate:local
npm run dev
```

The application is accessible at `http://localhost:8787`.
