/**
 * Markdown for agents: content negotiation on Cloudflare Pages.
 *
 * A page request whose Accept header prefers `text/markdown` gets the page's
 * Markdown twin (`<path>index.md`, built by the `index.md.ts` endpoints in
 * src/pages). Everything else, browsers included, gets the HTML as before.
 * Static assets skip this Function entirely via public/_routes.json.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface PagesContext {
  request: Request;
  env: Env;
  next(): Promise<Response>;
}

// Specificity of the ranges that can cover text/html, most specific wins.
const HTML_RANGES: Record<string, number> = {
  "text/html": 2,
  "text/*": 1,
  "*/*": 0,
};

/** True when text/markdown is listed and weighted at least as high as HTML. */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;

  let markdownQ = 0;
  let htmlQ = 0;
  let htmlSpecificity = -1;

  for (const entry of accept.toLowerCase().split(",")) {
    const [range, ...params] = entry.split(";").map(part => part.trim());
    const qParam = params.find(param => param.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q)) continue;

    if (range === "text/markdown") {
      markdownQ = Math.max(markdownQ, q);
    } else if (range in HTML_RANGES && HTML_RANGES[range] > htmlSpecificity) {
      htmlSpecificity = HTML_RANGES[range];
      htmlQ = q;
    }
  }

  return markdownQ > 0 && markdownQ >= htmlQ;
}

function withVaryAccept(response: Response): Response {
  const varied = new Response(response.body, response);
  varied.headers.append("Vary", "Accept");
  return varied;
}

export const onRequest = async ({
  request,
  env,
  next,
}: PagesContext): Promise<Response> => {
  const url = new URL(request.url);
  const isPageRequest =
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname.endsWith("/");

  if (!isPageRequest) return next();

  if (prefersMarkdown(request.headers.get("Accept"))) {
    const twin = await env.ASSETS.fetch(
      new Request(new URL(`${url.pathname}index.md`, url))
    );

    if (twin.ok) {
      const markdown = await twin.text();
      const headers = new Headers({
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: "Accept",
        // Rough estimate (~4 characters per token), as Cloudflare's own feature uses.
        "x-markdown-tokens": String(Math.ceil(markdown.length / 4)),
      });
      // Keep the twin's caching, canonical Link (public/_headers) and the
      // preview-deployment noindex. Not Content-Encoding: text() decoded it.
      for (const name of ["Cache-Control", "Link", "X-Robots-Tag"]) {
        const value = twin.headers.get(name);
        if (value) headers.set(name, value);
      }

      return new Response(request.method === "HEAD" ? null : markdown, {
        headers,
      });
    }
    // No Markdown twin for this page (listings, tags, search): serve HTML.
  }

  const response = await next();
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.includes("text/html") ? withVaryAccept(response) : response;
};
