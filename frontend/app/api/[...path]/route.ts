import { NextRequest } from "next/server";

const API_BASE = (process.env.PUME_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

// Statuses the fetch spec forbids a body on.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

const ALLOWED_PATHS = [
  /^health$/,
  /^speech\/health$/,
  /^speech\/transcriptions$/,
  /^speech\/synthesis$/,
  /^speech\/synthesis\/[A-Za-z0-9-]+$/,
  /^experiments$/,
  /^experiments\/[A-Za-z0-9-]+$/,
  /^experiments\/[A-Za-z0-9-]+\/(turns(?:\/stream)?|demo-state|ratings)$/,
  /^experiments\/[A-Za-z0-9-]+\/keepsake-letter$/,
  /^keepsake-letters\/[A-Za-z0-9_-]+$/,
  /^commons\/today$/,
  /^commons\/(guestbook|installations)$/,
  /^commons\/traces\/[A-Za-z0-9-]+$/,
  /^commons\/traces\/[A-Za-z0-9-]+\/(reactions|reports)$/,
  /^memory-rooms\/[A-Za-z0-9-]+$/,
  /^memory-rooms\/[A-Za-z0-9-]+\/memories$/,
  /^memory-rooms\/[A-Za-z0-9-]+\/memories\/[A-Za-z0-9-]+$/,
  /^memory-rooms\/[A-Za-z0-9-]+\/memories\/[A-Za-z0-9-]+\/(placement|relocations|reactions|reports)$/,
];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const relativePath = path.join("/");
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(relativePath))) {
    return Response.json({ detail: "허용되지 않은 API 경로입니다." }, { status: 404 });
  }

  const upstream = new URL(`${API_BASE}/api/${relativePath}`);
  request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));

  const init: RequestInit = {
    method: request.method,
    cache: "no-store",
    headers: {
      "Content-Type": request.headers.get("content-type") || "application/json",
      ...(request.headers.get("x-ownership-token")
        ? { "X-Ownership-Token": request.headers.get("x-ownership-token") as string }
        : {}),
      ...(request.headers.get("x-visitor-token")
        ? { "X-Visitor-Token": request.headers.get("x-visitor-token") as string }
        : {}),
    },
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(210_000)]),
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(upstream, init);
    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";
    if (
      response.body
      && (contentType.includes("application/x-ndjson") || contentType.startsWith("audio/"))
    ) {
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache, no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }
    const body = await response.arrayBuffer();
    const retryAfter = response.headers.get("retry-after");
    // 204/205/304 may not carry a body: handing Response even a zero-length
    // buffer throws, and the catch below would report that as "server
    // unreachable" for a call that in fact succeeded. Deleting a guestbook
    // trace answers 204, so it looked like a failure while the row was gone.
    const bodyless = NULL_BODY_STATUSES.has(response.status);
    return new Response(bodyless ? null : body, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "마음연구소 서버 응답 시간이 초과되었습니다."
      : "마음연구소 서버에 연결할 수 없습니다.";
    return Response.json({ detail: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
