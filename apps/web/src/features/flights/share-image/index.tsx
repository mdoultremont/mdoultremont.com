import { useEffect, useRef, useState } from "react"
import type { Map as FlightMap } from "maplibre-gl"
import type { FlightDetail } from "@/features/flights/api"
import { Button, buttonVariants } from "@/features/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/ui/dialog"
import { renderShareImage } from "./render"

export function ShareImage({
  detail,
  map,
}: {
  detail: FlightDetail
  map: FlightMap | null
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{
    url: string
    file: File
    fallback: boolean
  } | null>(null)
  const urlRef = useRef("")
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    []
  )
  async function generate() {
    setOpen(true)
    setBusy(true)
    setError("")
    setResult(null)
    try {
      const image = await renderShareImage(detail, map)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const url = URL.createObjectURL(image.blob)
      urlRef.current = url
      setResult({
        url,
        file: new File([image.blob], `flight-${detail.flight.id}.png`, {
          type: "image/png",
        }),
        fallback: image.fallback,
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create the image. Please try again."
      )
    } finally {
      setBusy(false)
    }
  }
  const canShare =
    result &&
    typeof navigator !== "undefined" &&
    navigator.canShare?.({ files: [result.file] })
  async function share() {
    if (!result) return
    try {
      await navigator.share({ files: [result.file], title: "My flight" })
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError"))
        setError("Sharing failed. You can download the PNG instead.")
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void generate()}
      >
        Share image
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flight-viewer dark-surface max-h-[95dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Share your flight
            </DialogTitle>
            <DialogDescription>
              1080 × 1350 PNG, ready to save or share.
            </DialogDescription>
          </DialogHeader>
          {busy && <output>Preparing your image…</output>}
          {result && (
            <>
              <img
                src={result.url}
                alt="Flight map, sites, date and five flight statistics"
                className="mx-auto max-h-[60dvh] max-w-full rounded-md object-contain"
              />
              {result.fallback && (
                <p className="text-sm text-muted-foreground">
                  Map capture unavailable. Your image uses a track illustration.
                </p>
              )}
              <DialogFooter>
                <a
                  className={buttonVariants()}
                  href={result.url}
                  download={result.file.name}
                >
                  Download PNG
                </a>
                {canShare && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void share()}
                  >
                    Share
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {error && !result && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void generate()}
            >
              Try again
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
