export const siteUrl = "https://mdoultremont.com"

export type OgImage = { eyebrow: string; title: string }

type PageHead = {
  title: string
  description: string
  path: string
  noindex?: boolean
  ogImage?: OgImage
}

export function pageHead({
  title,
  description,
  path,
  noindex,
  ogImage,
}: PageHead) {
  const url = new URL(path, siteUrl).href
  const imageUrl = new URL(
    `/og/${path.split("/").filter(Boolean).join("-") || "home"}.png`,
    siteUrl
  )
  imageUrl.search = new URLSearchParams(ogImage).toString()
  return {
    meta: [
      { title },
      ...(noindex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      ...(ogImage
        ? [
            { property: "og:image", content: imageUrl.href },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
            {
              property: "og:image:alt",
              content: `${ogImage.title} · ${ogImage.eyebrow}`,
            },
            { name: "twitter:card", content: "summary_large_image" },
          ]
        : []),
    ],
    links: noindex ? [] : [{ rel: "canonical", href: url }],
  }
}
