import { readFile } from "node:fs/promises";
import type { APIRoute } from "astro";
import { markdownResponse } from "@/utils/markdownDocument";

// The home page's Markdown twin is the curated post index in public/llms.txt.
export const GET: APIRoute = async () =>
  markdownResponse(await readFile("public/llms.txt", "utf8"));
