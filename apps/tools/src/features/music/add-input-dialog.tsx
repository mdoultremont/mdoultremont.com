import { CircleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { SpotifyPlaylist } from "@mdoultremont/tools-contracts/music"
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
import { Spinner } from "@/features/ui/spinner"
import { useInputLibrary } from "./input-library"
import { PlaylistCombobox } from "./playlist-combobox"

type Choices =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly playlists: readonly SpotifyPlaylist[] }

/** Adds an owned Spotify playlist as a source. Destination and review playlists are left out. */
export function AddInputDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onAdded?: (playlistId: string) => void
}) {
  const { reload } = useInputLibrary()
  const [choices, setChoices] = useState<Choices>({ status: "loading" })
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<SpotifyPlaylist | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setChoices({ status: "loading" })
    setQuery("")
    setSelected(null)
    setError(null)
    Promise.all([
      api.music.spotify.playlists(),
      api.music.sources.get(),
      api.music.destinations.get(),
    ])
      .then(([spotify, sources, destinations]) => {
        if (!active) return
        const taken = new Set([
          ...sources.sources.flatMap((source) =>
            source.sourceId.kind === "playlist"
              ? [source.sourceId.playlistId]
              : []
          ),
          ...destinations.destinations.map(
            (destination) => destination.playlistId
          ),
          ...(destinations.reviewPlaylistId
            ? [destinations.reviewPlaylistId]
            : []),
        ])
        setChoices({
          status: "ready",
          playlists: spotify.items.filter(
            (playlist) => !taken.has(playlist.id)
          ),
        })
      })
      .catch((cause: unknown) => {
        if (active)
          setChoices({
            status: "error",
            message: errorMessage(
              cause,
              "Spotify playlists could not be loaded. Close this dialog and try again."
            ),
          })
      })
    return () => {
      active = false
    }
  }, [open])

  async function add() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await api.music.sources.add({ playlistId: selected.id })
      reload()
      onOpenChange(false)
      onAdded?.(selected.id)
    } catch (cause) {
      setError(errorMessage(cause, "The playlist could not be added"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add input playlist</DialogTitle>
          <DialogDescription>
            Choose a playlist you own, such as My Shazam Tracks. Its tracks are
            read every hour. The playlist itself is never changed.
          </DialogDescription>
        </DialogHeader>
        {choices.status === "loading" ? (
          <output className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" />
            Loading your Spotify playlists…
          </output>
        ) : choices.status === "error" ? (
          <p role="alert" className="text-sm">
            {choices.message}
          </p>
        ) : (
          <PlaylistCombobox
            playlists={choices.playlists}
            value={query}
            selected={selected}
            open={menuOpen}
            disabled={busy}
            onValueChange={(value) => {
              setQuery(value)
              setSelected(null)
              setMenuOpen(true)
            }}
            onOpenChange={setMenuOpen}
            onSelect={(playlist) => {
              setSelected(playlist)
              setQuery(playlist.name)
              setMenuOpen(false)
            }}
          />
        )}
        {error ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !selected}
            onClick={() => void add()}
          >
            {busy ? <Spinner aria-hidden="true" /> : null}
            Add playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
