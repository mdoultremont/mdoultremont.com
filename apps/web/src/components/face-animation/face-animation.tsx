import type { CSSProperties } from "react"
import metadata from "virtual:portfolio-images"
import { imageUrl } from "../../features/images/images"
import { imageCandidates, staticSource } from "./animations"
import { useFacePlayback } from "./use-face-playback"
import styles from "./face-animation.module.css"

export type FaceAnimationProps = {
  className?: string
  withHover?: boolean
  withIdle?: boolean
}

export function FaceAnimation({
  className,
  withIdle = false,
  withHover = false,
}: FaceAnimationProps) {
  const { element, playback } = useFacePlayback({ withIdle, withHover })

  const style = playback
    ? ({
        "--frames": playback.sprite.frameCount,
        "--duration": `${playback.sprite.frameCount * playback.sprite.frameDurationMs}ms`,
        "--iterations": playback.loop ? "infinite" : 1,
      } as CSSProperties)
    : undefined

  return (
    <span
      ref={element}
      aria-hidden="true"
      className={["relative block size-10", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <img
        className={`block size-full motion-reduce:visible ${playback ? "invisible" : ""}`}
        src={imageUrl(staticSource, 40, metadata[staticSource].version)}
        srcSet={imageCandidates(staticSource)}
        width={40}
        height={40}
        alt=""
      />
      {playback && (
        <span
          className="absolute inset-0 overflow-hidden motion-reduce:hidden"
          key={playback.sequence}
        >
          <img
            className={`block h-full w-[calc(var(--frames)*100%)] max-w-none motion-reduce:animate-none ${styles.strip}`}
            src={playback.url}
            alt=""
          />
        </span>
      )}
    </span>
  )
}
