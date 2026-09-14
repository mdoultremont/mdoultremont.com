import type { ImgHTMLAttributes } from "react"
import type { ImageMetadata } from "../../tooling/image-metadata"
import { imageWidths } from "../image-options"

export function imageUrl(src: string, width: number, version: string) {
  return `/images${src}?width=${width}&v=${encodeURIComponent(version)}`
}

type Props = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height"
> & {
  src: string
  image: ImageMetadata
  optimized?: boolean
  sizes?: string
}

export function ResponsiveImage({
  src,
  image,
  optimized = true,
  sizes = "100vw",
  ...props
}: Props) {
  const candidates = imageWidths(src, image)
  const srcSet = optimized
    ? candidates
        .map((width) => `${imageUrl(src, width, image.version)} ${width}w`)
        .join(",")
    : undefined
  return (
    <img
      {...props}
      alt={props.alt ?? ""}
      src={
        optimized
          ? imageUrl(src, Math.min(image.width, 640), image.version)
          : src
      }
      srcSet={srcSet}
      sizes={optimized ? sizes : undefined}
      width={image.width}
      height={image.height}
    />
  )
}
