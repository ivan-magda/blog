import { readFile } from "node:fs/promises";
import type { APIRoute } from "astro";
import { SITE } from "@/config";
import {
  markdownDocument,
  markdownResponse,
  stripFrontmatter,
} from "@/utils/markdownDocument";

// Markdown twin of src/pages/about.md (/about/).
export const GET: APIRoute = async () => {
  const source = await readFile("src/pages/about.md", "utf8");

  return markdownResponse(
    markdownDocument({
      title: "About",
      url: new URL("/about/", SITE.website).href,
      meta: { author: SITE.author },
      body: stripFrontmatter(source),
    })
  );
};
