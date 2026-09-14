import { useEffect, useRef, useState } from "react"
import { hoverAnimations, idleAnimation, loadSprite } from "./animations"
import type { FaceSprite } from "./animations"

export type FacePlaybackOptions = {
  withHover: boolean
  withIdle: boolean
}

type Playback = {
  sprite: FaceSprite
  url: string
  sequence: number
  loop: boolean
}

export function useFacePlayback({ withIdle, withHover }: FacePlaybackOptions) {
  const element = useRef<HTMLSpanElement>(null)
  const [playback, setPlayback] = useState<Playback>()

  useEffect(() => {
    const node = element.current!
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const lifetime = new AbortController()
    let session = new AbortController()
    let sequence = 0
    let playingHover = false
    let hoverWaiting = false
    let nextHoverIndex = 0
    const ready = new Map<FaceSprite, HTMLImageElement>()
    const pending = new Set<FaceSprite>()

    function play(sprite: FaceSprite, loop: boolean) {
      const image = ready.get(sprite)
      if (!image) return
      setPlayback({ sprite, url: image.currentSrc, sequence: ++sequence, loop })
    }

    function rest() {
      playingHover = false
      if (withIdle && ready.has(idleAnimation)) play(idleAnimation, true)
      else setPlayback(undefined)
    }

    async function prepare(sprite: FaceSprite) {
      if (session.signal.aborted || ready.has(sprite) || pending.has(sprite))
        return
      pending.add(sprite)
      const { signal } = session
      try {
        const image = await loadSprite(sprite)
        if (signal.aborted) return
        ready.set(sprite, image)
        if (sprite === idleAnimation && !playingHover) rest()
        if (sprite === hoverAnimations[nextHoverIndex] && hoverWaiting) {
          playNextHover()
        }
      } catch {
        // Keep the static face or ready animation. Retry only on a later entry.
      } finally {
        if (!signal.aborted) pending.delete(sprite)
      }
    }

    function prepareNextHover() {
      const next = hoverAnimations[nextHoverIndex]
      if (next) void prepare(next)
    }

    function playNextHover() {
      hoverWaiting = false
      playingHover = true
      play(hoverAnimations[nextHoverIndex], false)
      nextHoverIndex = (nextHoverIndex + 1) % hoverAnimations.length
      prepareNextHover()
    }

    function start() {
      session.abort()
      pending.clear()
      setPlayback(undefined)
      playingHover = false
      hoverWaiting = false
      nextHoverIndex = 0
      if (motion.matches || document.readyState !== "complete") return
      session = new AbortController()
      if (withIdle) {
        rest()
        void prepare(idleAnimation)
      }
      if (withHover) prepareNextHover()
    }

    function enter(event: PointerEvent) {
      if (session.signal.aborted || !withHover || event.pointerType === "touch")
        return
      const sprite = hoverAnimations[nextHoverIndex]
      if (!sprite) return
      if (ready.has(sprite)) {
        playNextHover()
      } else {
        const fallback = hoverAnimations.find((candidate) =>
          ready.has(candidate)
        )
        if (fallback) {
          playingHover = true
          play(fallback, false)
        } else {
          hoverWaiting = true
        }
        // A failed successor can be retried even while a ready hover plays.
        void prepare(sprite)
      }
    }

    function finish() {
      if (playingHover && !session.signal.aborted) rest()
    }

    // Browser subscriptions belong to this mount; decodes belong to the current
    // motion session. Aborting a session ignores its results without cancelling
    // shared sprite downloads that another mounted face may still need.
    const { signal } = lifetime
    window.addEventListener("load", start, { signal, once: true })
    motion.addEventListener("change", start, { signal })
    node.addEventListener("pointerenter", enter, { signal })
    node.addEventListener("animationend", finish, { signal })
    start()
    return () => {
      lifetime.abort()
      session.abort()
    }
  }, [withIdle, withHover])

  return { element, playback }
}
