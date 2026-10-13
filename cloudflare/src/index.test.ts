import { describe, it, expect } from "vitest";
import worker from "./index";

describe("Plane Cloudflare Worker", () => {
  const mockEnv: any = {
    SERVER_NAME: "Plane Cloudflare Test Edition",
    PLANE_URL: "http://localhost:8787",
    API_ORIGIN: "http://localhost:8000",
    BUCKET_NAME: "plane-files",
    LIVE_ORIGIN: "http://localhost:3100",
    USE_DURABLE_OBJECTS_FOR_LIVE: "false",
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          run: async () => ({ success: true }),
        }),
      }),
    },
  };

  it("responds with healthy status on /healthz", async () => {
    const request = new Request("http://localhost:8787/healthz");
    const response = await worker.fetch(request, mockEnv, {} as any);

    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.status).toBe("healthy");
    expect(json.version).toBe("1.4.2");
  });

  it("responds with edge info on /api/v1/edge/info", async () => {
    const request = new Request("http://localhost:8787/api/v1/edge/info");
    const response = await worker.fetch(request, mockEnv, {} as any);

    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.server).toBe("Plane Cloudflare Test Edition");
    expect(json.bindings.d1).toBe(true);
  });
});
