import { CircleAlertIcon, ImageIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { errorReason } from "@mdoultremont/tools-contracts"
import { coverMaxBase64Length } from "@mdoultremont/tools-contracts/music"
import { api, errorMessage } from "@/features/api"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button } from "@/features/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/ui/dialog"
import { Input } from "@/features/ui/input"
import { Label } from "@/features/ui/label"
import { Spinner } from "@/features/ui/spinner"
import { toast } from "@/features/ui/toast"
import { useOutputLibrary, type OutputPlaylist } from "./output-library"

const jpegPrefix = "data:image/jpeg;base64,"

type Failure = { readonly message: string; readonly reconnect: boolean }

/** Replaces an output playlist's Spotify cover with an image chosen here. */
export function CoverDialog({
  playlist,
  open,
  onOpenChange,
}: {
  readonly playlist: OutputPlaylist
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const { setCover } = useOutputLibrary()
  const inputId = useId()
  const [image, setImage] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  useEffect(() => {
    if (!open) return
    setImage(null)
    setFailure(null)
  }, [open])

  async function choose(file: File | undefined) {
    if (!file) return
    setReading(true)
    setFailure(null)
    try {
      setImage(await coverJpeg(file))
    } catch {
      setImage(null)
      setFailure({
        message: "This image could not be read. Choose a JPEG, PNG, or WebP.",
        reconnect: false,
      })
    } finally {
      setReading(false)
    }
  }

  async function upload() {
    if (!image) return
    setBusy(true)
    setFailure(null)
    try {
      await api.music.spotify.setPlaylistCover({
        playlistId: playlist.playlistId,
        image: image.slice(jpegPrefix.length),
      })
      setCover(playlist.playlistId, image)
      onOpenChange(false)
      toast("Cover sent to Spotify. It can take a minute to show there.")
    } catch (cause) {
      setFailure({
        message: errorMessage(cause, "The cover could not be uploaded"),
        reconnect: errorReason(cause) === "CoverPermissionMissing",
      })
    } finally {
      setBusy(false)
    }
  }

  const shown = image ?? playlist.imageUrl
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change cover</DialogTitle>
          <DialogDescription>
            The image replaces the cover of {playlist.name} on Spotify. It is
            cropped to a square.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4">
          <div className="flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {shown ? (
              <img
                src={shown}
                alt={image ? "New cover" : "Current cover"}
                className="size-full object-cover"
              />
            ) : (
              <ImageIcon
                aria-hidden="true"
                className="size-6 text-muted-foreground"
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={inputId}>Image</Label>
            <Input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || reading}
              onChange={(event) => void choose(event.target.files?.[0])}
            />
            {reading ? (
              <output className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner aria-hidden="true" />
                Preparing image…
              </output>
            ) : null}
          </div>
        </div>
        {failure ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>
              {failure.message}
              {failure.reconnect ? (
                <>
                  {" "}
                  <a
                    className="underline underline-offset-4"
                    href="/api/music/spotify/connect"
                  >
                    Connect Spotify again
                  </a>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!image || busy} onClick={() => void upload()}>
            {busy ? <Spinner aria-hidden="true" /> : null}
            Upload to Spotify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A centered square JPEG data URL small enough for Spotify's cover limit. */
async function coverJpeg(file: File) {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    for (const size of [640, 480, 320]) {
      const canvas = document.createElement("canvas")
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas is unavailable")
      context.fillStyle = "#fff"
      context.fillRect(0, 0, size, size)
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size
      )
      for (const quality of [0.9, 0.8, 0.7, 0.6]) {
        const url = canvas.toDataURL("image/jpeg", quality)
        if (url.length - jpegPrefix.length <= coverMaxBase64Length) return url
      }
    }
    throw new Error("Image is too detailed to fit Spotify's limit")
  } finally {
    bitmap.close()
  }
}
