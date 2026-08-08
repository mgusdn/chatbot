import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET } from "@/app/api/[...path]/route";
import { NextRequest } from "next/server";

function proxyRequest(path: string[], method = "GET") {
  const request = new NextRequest(`http://localhost:3000/api/${path.join("/")}`, { method });
  return { request, context: { params: Promise.resolve({ path }) } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api proxy", () => {
  it("passes a 204 through instead of reporting the backend as unreachable", async () => {
    // A body-less status must reach Response as null; handing it even an empty
    // buffer throws, and the proxy would turn a successful delete into a 502.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(null, { status: 204, headers: { "content-type": "application/json" } }),
    ));

    const { request, context } = proxyRequest(["commons", "traces", "abc123"], "DELETE");
    const response = await DELETE(request, context);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("still forwards a normal JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ counts: { total: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));

    const { request, context } = proxyRequest(["commons", "today"]);
    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ counts: { total: 2 } });
  });

  it("keeps an error status and its detail readable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "권한이 없습니다." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ));

    const { request, context } = proxyRequest(["commons", "traces", "abc123"], "DELETE");
    const response = await DELETE(request, context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ detail: "권한이 없습니다." });
  });

  it("rejects a path outside the allowlist without calling the backend", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const { request, context } = proxyRequest(["not", "allowed"]);
    const response = await GET(request, context);

    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
