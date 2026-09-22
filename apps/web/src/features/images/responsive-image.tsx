import type { ImgHTMLAttributes } from "react"
import type { ImageMetadata, ImageWidthRole } from "./images"
import { imageWidths, imageUrl } from "./images"

type Props = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height"
> & {
  src: string
  image: ImageMetadata
  optimized?: boolean
  widthRole?: ImageWidthRole
  sizes?: string
}

export function ResponsiveImage({
  src,
  image,
  optimized = true,
  widthRole = "default",
  sizes = "100vw",
  ...props
}: Props) {
  const candidates = imageWidths(src, image, widthRole)
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
