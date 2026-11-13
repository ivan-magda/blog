const WORDS_PER_MINUTE = 220;

/**
 * Estimated minutes to read a post, from its Markdown source.
 * Code blocks and markup count as words too: readers of these posts
 * read the listings, so stripping them would understate the time.
 */
export function getReadingMinutes(markdown: string | undefined): number {
  if (!markdown) return 0;
  const words = markdown
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
