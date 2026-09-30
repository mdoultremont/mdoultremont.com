import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { imageWidths } from "./images"
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
    expect(html).toContain("1024w")
    expect(html).not.toContain("1200w")
    expect(html).not.toContain("1280w")
  })

  test("selects bounded role candidates and falls back to the source width", () => {
    expect(
      imageWidths("/media/photography/photo.jpg", image, "gallery")
    ).toEqual([320, 640, 1024])
    expect(imageWidths("/media/photography/photo.jpg", image, "modal")).toEqual(
      [640, 1024]
    )
    expect(
      imageWidths(
        "/media/photography/small.jpg",
        { ...image, width: 200 },
        "modal"
      )
    ).toEqual([200])
  })

  test("preserves the face width policies regardless of role", () => {
    expect(
      imageWidths(
        "/media/brand/face/static.png",
        { ...image, width: 100 },
        "modal"
      )
    ).toEqual([40, 80, 100])
  })
})
