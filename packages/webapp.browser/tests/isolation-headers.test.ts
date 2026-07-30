import { describe, expect, it } from "vitest";
import { withIsolationHeaders } from "../src/isolation-headers.js";

describe("withIsolationHeaders", () => {
  it("stamps the COEP + CORP isolation headers on the wrapped response", async () => {
    // Hermetic node check for the "isolation headers present" spec scenario at the
    // seam that is node-checkable — no ServiceWorker involved.
    const inner = async (_request: Request): Promise<Response> =>
      new Response("<!doctype html>hello", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    const wrapped = withIsolationHeaders(inner);
    const res = await wrapped(new Request("http://site.local/~/client/index.html"));

    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    // Original status + body + pre-existing headers survive.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(await res.text()).toContain("<!doctype html>");
  });

  it("does not mutate the source response's headers", async () => {
    const source = new Response("x", { status: 200 });
    const wrapped = withIsolationHeaders(async () => source);
    await wrapped(new Request("http://site.local/"));
    expect(source.headers.get("Cross-Origin-Embedder-Policy")).toBeNull();
  });
});
