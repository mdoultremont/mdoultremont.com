import { useEffect, useRef } from "react"

type LookAtPointerProps = {
  className?: string
  radius?: number
  src?: string
  stepDuration?: number
}

const defaultSource = "/media/brand/gaze-sprite.png"
const centerFrame = 2

export function LookAtPointer({
  className,
  radius = 250,
  src = defaultSource,
  stepDuration = 60,
}: LookAtPointerProps) {
  const spriteRef = useRef<HTMLSpanElement>(null)
  const currentFrame = useRef({ x: centerFrame, y: centerFrame })
  const targetFrame = useRef({ x: centerFrame, y: centerFrame })
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const pointerIsFine = window.matchMedia("(pointer: fine)")

    function setFrame(x: number, y: number) {
      if (!spriteRef.current) return

      spriteRef.current.style.setProperty("--gaze-x", `${x * 25}%`)
      spriteRef.current.style.setProperty("--gaze-y", `${y * 25}%`)
    }

    function setScale(scale: number) {
      if (!spriteRef.current) return

      spriteRef.current.style.setProperty("--gaze-scale", scale.toFixed(3))
    }

    function advanceFrame() {
      const current = currentFrame.current
      const target = targetFrame.current

      if (current.x === target.x && current.y === target.y) {
        stepTimer.current = null
        return
      }

      current.x += Math.sign(target.x - current.x)
      current.y += Math.sign(target.y - current.y)
      setFrame(current.x, current.y)
      stepTimer.current = setTimeout(advanceFrame, stepDuration)
    }

    function setTargetFrame(x: number, y: number) {
      targetFrame.current = { x, y }
      if (!stepTimer.current) advanceFrame()
    }

    function followPointer(event: PointerEvent) {
      if (!pointerIsFine.matches || !spriteRef.current) return

      const bounds = spriteRef.current.getBoundingClientRect()
      const x = event.clientX - (bounds.left + bounds.width / 2)
      const y = event.clientY - (bounds.top + bounds.height / 2)
      const distance = Math.hypot(x, y)

      if (distance > radius) {
        setScale(1)
        setTargetFrame(centerFrame, centerFrame)
        return
      }

      const horizontal = Math.max(-1, Math.min(x / radius, 1))
      const vertical = Math.max(-1, Math.min(y / radius, 1))
      const scale = 1.025 + (1 - distance / radius) * 0.075

      setScale(scale)
      setTargetFrame(
        Math.round((horizontal + 1) * 2),
        Math.round((vertical + 1) * 2)
      )
    }

    window.addEventListener("pointermove", followPointer, { passive: true })
    return () => {
      window.removeEventListener("pointermove", followPointer)
      if (stepTimer.current) clearTimeout(stepTimer.current)
    }
  }, [radius, stepDuration])

  return (
    <span
      ref={spriteRef}
      aria-hidden="true"
      className={[
        "[background-position:var(--gaze-x)_var(--gaze-y)] bg-no-repeat bg-[size:500%_500%] [transform:scale(var(--gaze-scale,1))] transition-transform duration-180 ease-out",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundImage: `url("${src}")` }}
    />
  )
}
