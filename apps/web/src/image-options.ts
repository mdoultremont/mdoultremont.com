import type { ImageMetadata } from "../tooling/image-metadata"

export const responsiveWidths = [320, 480, 640, 768, 1024, 1280, 1536]
export const staticFaceWidths = [40, 80, 120]
export const faceSpriteWidths = [360, 720, 1080]

export function imageWidths(src: string, image: ImageMetadata) {
  const widths =
    src === "/media/brand/face/static.png"
      ? staticFaceWidths
      : src.startsWith("/media/brand/face/")
        ? faceSpriteWidths
        : responsiveWidths

  return [...widths.filter((width) => width < image.width), image.width]
}
