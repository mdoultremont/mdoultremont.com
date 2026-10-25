import { Link, useNavigate } from "@tanstack/react-router"
import { EllipsisIcon } from "lucide-react"
import { useState } from "react"
import type { Source } from "@mdoultremont/tools-contracts/music"
import { api, errorMessage } from "@/features/api"
import { PageHeader } from "@/features/apps/shell"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/features/ui/alert-dialog"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu"
import { Spinner } from "@/features/ui/spinner"
import { toast } from "@/features/ui/toast"
import { useInputLibrary, type InputPlaylist } from "./input-library"
import { inputPath } from "./music-nav"
import { LibraryFallback } from "./playlist-library"
import { PlaylistTracks } from "./playlist-tracks"

export function InputPlaylistPage({ playlistKey }: { playlistKey: string }) {
  const { library, reload } = useInputLibrary()
  if (library.status !== "ready")
    return <LibraryFallback library={library} reload={reload} />
  const playlist = library.playlists.find((entry) => entry.key === playlistKey)
  if (!playlist)
    return (
      <>
        <PageHeader title="Playlist unavailable" />
        <p className="text-sm text-muted-foreground">
          This playlist is no longer an input playlist. Choose another one in
          the sidebar.
        </p>
      </>
    )
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {playlist.name}
            {playlist.source.enabled ? null : (
              <Badge variant="secondary">Paused</Badge>
            )}
          </span>
        }
        description={describe(playlist)}
        actions={<PlaylistActions playlist={playlist} />}
      />
      {library.namesMissing ? (
        <output className="mb-4 block text-sm text-muted-foreground">
          Spotify playlist names could not be loaded. Playlist IDs are shown
          instead.
        </output>
      ) : null}
      <PlaylistTracks
        key={playlist.key}
        collection={playlist.source.sourceId}
        name={playlist.name}
        showName={false}
      />
    </>
  )
}

function describe({ source }: InputPlaylist) {
  const kind =
    source.sourceId.kind === "liked"
      ? "Your saved tracks on Spotify."
      : "A Spotify playlist you own."
  if (!source.enabled)
    return `${kind} Paused: its tracks are not sorted, but you can still browse them.`
  return `${kind} ${source.present} tracks collected${source.removed > 0 ? `, ${source.removed} removed` : ""}.`
}

function PlaylistActions({ playlist }: { playlist: InputPlaylist }) {
  const { reload } = useInputLibrary()
  const navigate = useNavigate()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = playlist.source.sourceId

  async function change(run: () => Promise<unknown>, after?: () => void) {
    setBusy(true)
    try {
      await run()
      reload()
      after?.()
    } catch (cause) {
      toast(errorMessage(cause, "The playlist could not be changed"), {
        type: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label={`${playlist.name} actions`}
              disabled={busy}
            />
          }
        >
          {busy ? (
            <Spinner aria-hidden="true" />
          ) : (
            <EllipsisIcon aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            onClick={() =>
              void change(() =>
                api.music.sources.setEnabled({
                  sourceId: id,
                  enabled: !playlist.source.enabled,
                })
              )
            }
          >
            {playlist.source.enabled ? "Pause sorting" : "Resume sorting"}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<Link to="/music/settings" hash="input-playlists" />}
          >
            Manage input playlists
          </DropdownMenuItem>
          {id.kind === "playlist" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmRemove(true)}
              >
                Remove input playlist
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {id.kind === "playlist" ? (
        <RemoveDialog
          name={playlist.name}
          source={playlist.source}
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          onConfirm={() =>
            void change(
              () => api.music.sources.remove({ playlistId: id.playlistId }),
              () => void navigate({ to: inputPath("liked") })
            )
          }
        />
      ) : null}
    </>
  )
}

function RemoveDialog({
  name,
  source,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string
  source: Source
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its {source.present} tracks stop being sorted unless another input
            playlist has them. The Spotify playlist and tracks already delivered
            stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
