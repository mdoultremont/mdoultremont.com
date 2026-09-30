export type ImageMetadata = { width: number; height: number; version: string }
export type ImageWidthRole = "default" | "gallery" | "modal"

export const responsiveWidths = [320, 480, 640, 768, 1024, 1280, 1536]
export const galleryWidths = [320, 640, 1024, 1536]
export const modalWidths = [640, 1024, 1536, 2560]
export const staticFaceWidths = [40, 80, 120]
export const faceSpriteWidths = [360, 720, 1080]

export function imageWidths(
  src: string,
  image: ImageMetadata,
  role: ImageWidthRole = "default"
) {
  const specialWidths = faceWidths(src)
  if (specialWidths) {
    return [
      ...specialWidths.filter((width) => width < image.width),
      image.width,
    ]
  }

  const widths = widthsForRole(role)
  const bounded = widths.filter((width) => width <= image.width)

  return bounded.length > 0 ? bounded : [image.width]
}

export function imageRequestWidths(src: string, image: ImageMetadata) {
  if (faceWidths(src)) return imageWidths(src, image)

  return [
    ...new Set([
      ...imageWidths(src, image),
      ...imageWidths(src, image, "gallery"),
      ...imageWidths(src, image, "modal"),
    ]),
  ]
}

function widthsForRole(role: ImageWidthRole) {
  return role === "gallery"
    ? galleryWidths
    : role === "modal"
      ? modalWidths
      : responsiveWidths
}

function faceWidths(src: string) {
  if (src === "/media/brand/face/static.png") return staticFaceWidths
  if (src.startsWith("/media/brand/face/")) return faceSpriteWidths
  return undefined
}

export function imageUrl(src: string, width: number, version: string) {
  return `/images${src}?width=${width}&v=${encodeURIComponent(version)}`
}
