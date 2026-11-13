import type { APIRoute } from "astro";
import { type CollectionEntry, getCollection } from "astro:content";
import { SITE } from "@/config";
import { getPath } from "@/utils/getPath";
import { markdownDocument, markdownResponse } from "@/utils/markdownDocument";

// Same routes as the HTML post pages in ./index.astro.
export async function getStaticPaths() {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  return posts.map(post => ({
    params: { slug: getPath(post.id, post.filePath, false) },
    props: { post },
  }));
}

export const GET: APIRoute<{ post: CollectionEntry<"blog"> }> = ({ props }) => {
  const { post } = props;
  const { data } = post;

  return markdownResponse(
    markdownDocument({
      title: data.title,
      url: new URL(getPath(post.id, post.filePath), SITE.website).href,
      meta: {
        description: data.description,
        author: data.author,
        published: data.pubDatetime.toISOString(),
        updated: data.modDatetime?.toISOString(),
        tags: data.tags,
        canonical: data.canonicalURL,
      },
      body: post.body ?? "",
    })
  );
};
