import { Link } from "@tanstack/react-router"
import { EllipsisIcon, ListMusicIcon } from "lucide-react"
import { useState } from "react"
import { api, errorMessage } from "@/features/api"
import { PageHeader } from "@/features/apps/shell"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu"
import { Spinner } from "@/features/ui/spinner"
import { toast } from "@/features/ui/toast"
import { CoverDialog } from "./cover-dialog"
import { useOutputLibrary, type OutputPlaylist } from "./output-library"
import { LibraryFallback } from "./playlist-library"
import { PlaylistTracks } from "./playlist-tracks"

export function OutputPlaylistPage({ playlistId }: { playlistId: string }) {
  const { library, reload } = useOutputLibrary()
  if (library.status !== "ready")
    return <LibraryFallback library={library} reload={reload} />
  const playlist = library.playlists.find(
    (entry) => entry.playlistId === playlistId
  )
  if (!playlist)
    return (
      <>
        <PageHeader title="Playlist unavailable" />
        <p className="text-sm text-muted-foreground">
          This playlist is no longer an output playlist. Choose another one in
          the sidebar.
        </p>
      </>
    )
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <PlaylistCover imageUrl={playlist.imageUrl} />
            {playlist.name}
            {playlist.role === "review" ? (
              <Badge variant="outline">Review</Badge>
            ) : null}
            {playlist.enabled ? null : (
              <Badge variant="secondary">Paused</Badge>
            )}
          </span>
        }
        description={playlist.description || undefined}
        actions={<PlaylistActions playlist={playlist} />}
      />
      {library.namesMissing ? (
        <output className="mb-4 block text-sm text-muted-foreground">
          Spotify playlist names could not be loaded. Playlist IDs are shown
          instead.
        </output>
      ) : null}
      <PlaylistTracks
        key={playlist.playlistId}
        collection={{ kind: "playlist", playlistId: playlist.playlistId }}
        name={playlist.name}
        showName={false}
      />
    </>
  )
}

function PlaylistCover({ imageUrl }: { imageUrl: string | null }) {
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted md:size-14">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <ListMusicIcon
          aria-hidden="true"
          className="size-5 text-muted-foreground"
        />
      )}
    </span>
  )
}

function PlaylistActions({ playlist }: { playlist: OutputPlaylist }) {
  const { reload } = useOutputLibrary()
  const [busy, setBusy] = useState(false)
  const [changingCover, setChangingCover] = useState(false)

  async function setEnabled(enabled: boolean) {
    setBusy(true)
    try {
      await api.music.destinations.save({
        playlistId: playlist.playlistId,
        description: playlist.description,
        enabled,
      })
      reload()
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
          {playlist.role === "destination" ? (
            <DropdownMenuItem
              disabled={playlist.enabled ? false : !playlist.description}
              onClick={() => void setEnabled(!playlist.enabled)}
            >
              {playlist.enabled ? "Pause sorting" : "Resume sorting"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setChangingCover(true)}>
            Change cover
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/music/settings" />}>
            Manage output playlists
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CoverDialog
        playlist={playlist}
        open={changingCover}
        onOpenChange={setChangingCover}
      />
    </>
  )
}
