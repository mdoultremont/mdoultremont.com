import metadata from "virtual:portfolio-images"
import {
  faceSpriteWidths,
  staticFaceWidths,
} from "../../features/images/images"
import { imageUrl } from "../../features/images/images"

export type FaceSprite = {
  src: string
  frameCount: number
  frameDurationMs: number
}

export const staticSource = "/media/brand/face/static.png"
export const idleAnimation: FaceSprite = {
  src: "/media/brand/face/idle.png",
  frameCount: 9,
  frameDurationMs: 200,
}

export const hoverAnimations: readonly FaceSprite[] = [
  { src: "/media/brand/face/blink.png", frameCount: 9, frameDurationMs: 70 },
  { src: "/media/brand/face/wink.png", frameCount: 9, frameDurationMs: 80 },
]

export function imageCandidates(src: string, frameCount = 1) {
  const widths = frameCount === 1 ? staticFaceWidths : faceSpriteWidths
  return widths
    .map(
      (width, index) =>
        `${imageUrl(src, width, metadata[src].version)} ${index + 1}x`
    )
    .join(",")
}

// Retain decoded images across remounts, and share in-flight work. A failed
// request is evicted so a later interaction can retry without a retry loop.
const images = new Map<string, Promise<HTMLImageElement>>()

export function loadSprite(sprite: FaceSprite) {
  const candidates = imageCandidates(sprite.src, sprite.frameCount)
  let pending = images.get(candidates)
  if (!pending) {
    const image = new Image()
    image.decoding = "async"
    image.fetchPriority = "low"
    image.srcset = candidates
    pending = image
      .decode()
      .then(() => image)
      .catch((error: unknown) => {
        images.delete(candidates)
        throw error
      })
    images.set(candidates, pending)
  }
  return pending
}
