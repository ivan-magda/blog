/**
 * Markdown representations of pages, served to agents that send
 * `Accept: text/markdown` (see `functions/_middleware.ts`). Each page that has
 * one is built to `<page path>index.md` next to its `index.html`.
 */

type MarkdownDocument = {
  title: string;
  url: string;
  meta?: Record<string, string | string[] | undefined | null>;
  body: string;
};

// JSON strings are valid YAML scalars, so this escapes quotes, colons, etc.
const yamlValue = (value: string | string[]) => JSON.stringify(value);

export function markdownDocument({
  title,
  url,
  meta = {},
  body,
}: MarkdownDocument) {
  const fields: string[] = [];
  for (const [key, value] of Object.entries({ title, url, ...meta })) {
    if (value == null || (Array.isArray(value) && value.length === 0)) continue;
    fields.push(`${key}: ${yamlValue(value)}`);
  }

  return `---\n${fields.join("\n")}\n---\n\n# ${title}\n\n${body.trim()}\n`;
}

/** Drops a leading `---` frontmatter block from a Markdown source file. */
export function stripFrontmatter(source: string) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export function markdownResponse(markdown: string) {
  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
