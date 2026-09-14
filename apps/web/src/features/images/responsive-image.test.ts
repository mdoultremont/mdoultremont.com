import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ResponsiveImage } from "./responsive-image"

const image = { width: 1200, height: 800, version: "abc123" }

describe("responsive portfolio images", () => {
  test("serves a versioned responsive portrait without changing its CMS path", () => {
    const html = renderToStaticMarkup(
      createElement(ResponsiveImage, {
        src: "/media/profile/portrait.png",
        image,
        optimized: true,
        alt: "Matthieu",
        sizes: "(min-width: 1024px) 50vw, 100vw",
      })
    )
    expect(html).toContain('width="1200" height="800"')
    expect(html).toContain('alt="Matthieu"')
    expect(html).toContain(
      "/images/media/profile/portrait.png?width=320&amp;v=abc123 320w"
    )
    expect(html).toContain("1200w")
    expect(html).not.toContain("1280w")
  })
})
