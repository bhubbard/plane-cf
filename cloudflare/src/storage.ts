import { Env } from "./types";

export async function handleR2Get(
  key: string,
  request: Request,
  env: Env
): Promise<Response> {
  const rangeHeader = request.headers.get("Range");
  const options: R2GetOptions = {
    onlyIf: {
      etagMatches: request.headers.get("if-match") || undefined,
      etagDoesNotMatch: request.headers.get("if-none-match") || undefined,
      uploadedAfter: request.headers.get("if-modified-since")
        ? new Date(request.headers.get("if-modified-since")!)
        : undefined,
      uploadedBefore: request.headers.get("if-unmodified-since")
        ? new Date(request.headers.get("if-unmodified-since")!)
        : undefined,
    },
  };

  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (rangeMatch) {
      const offset = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined;
      const length = end !== undefined ? end - offset + 1 : undefined;
      options.range = { offset, length };
    }
  }

  const object = await env.FILES.get(key, options);

  if (!object) {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Accept-Ranges", "bytes");

  if ("range" in object && object.range) {
    const r = object.range as { offset: number; length: number };
    headers.set(
      "Content-Range",
      `bytes ${r.offset}-${r.offset + r.length - 1}/${object.size}`
    );
    return new Response(object.body, {
      status: 206,
      headers,
    });
  }

  return new Response(object.body, {
    status: 200,
    headers,
  });
}

export async function handleR2Put(
  key: string,
  request: Request,
  env: Env
): Promise<Response> {
  const contentType =
    request.headers.get("Content-Type") || "application/octet-stream";

  const object = await env.FILES.put(key, request.body, {
    httpMetadata: {
      contentType,
    },
  });

  return new Response(
    JSON.stringify({
      success: true,
      key: object.key,
      size: object.size,
      etag: object.httpEtag,
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function handleR2Delete(
  key: string,
  env: Env
): Promise<Response> {
  await env.FILES.delete(key);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
