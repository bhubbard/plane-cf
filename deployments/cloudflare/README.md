# Cloudflare Deployment Guide for Plane

This directory contains deployment manifests and instructions for deploying Plane with Cloudflare Services.

## Files

- `docker-compose.cloudflare.yml`: Docker Compose stack running API, Celery, and database, relying on Cloudflare R2 for storage and Cloudflare Worker for routing instead of local MinIO or Caddy.
- `variables.cloudflare.env`: Pre-configured environment variables for connecting Plane to Cloudflare R2 and Cloudflare Edge.

## Deployment Instructions

1. Configure `variables.cloudflare.env`:
   - Set your domain name.
   - Enter your Cloudflare Account ID and R2 credentials.
   - Generate secure values for `SECRET_KEY` and `LIVE_SERVER_SECRET_KEY`.

2. Start the core backend services:
   ```bash
   docker compose -f docker-compose.cloudflare.yml --env-file variables.cloudflare.env up -d
   ```

3. Deploy the Cloudflare Worker:
   ```bash
   cd ../../cloudflare
   npm run deploy
   ```
