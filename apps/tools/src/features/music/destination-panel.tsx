import { PlaylistCombobox } from "./playlist-combobox"
import { CircleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { api, errorMessage } from "@/features/api"
import type {
  DestinationConfiguration,
  SpotifyPlaylist,
} from "@mdoultremont/tools-contracts/music"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button } from "@/features/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import { FieldDescription, FieldLabel } from "@/features/ui/field"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/features/ui/item"
import { NativeSelect, NativeSelectOption } from "@/features/ui/native-select"
import { Separator } from "@/features/ui/separator"
import { Spinner } from "@/features/ui/spinner"
import { Textarea } from "@/features/ui/textarea"

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready"
      readonly config: DestinationConfiguration
      readonly playlists: readonly SpotifyPlaylist[]
    }

export function DestinationPanel() {
  const [view, setView] = useState<ViewState>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playlistQuery, setPlaylistQuery] = useState("")
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<SpotifyPlaylist | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDescription, setEditingDescription] = useState("")
  const [reviewId, setReviewId] = useState("")

  useEffect(() => {
    let active = true
    Promise.all([api.music.destinations.get(), api.music.spotify.playlists()])
      .then(([config, playlists]) => {
        if (!active) return
        setView({ kind: "ready", config, playlists: playlists.items })
        setReviewId(config.reviewPlaylistId ?? "")
      })
      .catch((cause: unknown) => {
        if (active)
          setView({
            kind: "error",
            message: errorMessage(
              cause,
              "Playlist settings could not be loaded"
            ),
          })
      })
    return () => {
      active = false
    }
  }, [])

  async function refresh() {
    const config = await api.music.destinations.get()
    const playlists = await api.music.spotify.playlists()
    setView({ kind: "ready", config, playlists: playlists.items })
    setReviewId(config.reviewPlaylistId ?? "")
  }

  async function mutate(change: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await change()
      try {
        await refresh()
      } catch {
        setError(
          "Saved, but the latest playlist settings could not be loaded. Refresh this page to check them."
        )
      }
      return true
    } catch (cause) {
      setError(errorMessage(cause, "Playlist settings could not be saved"))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addSelectedPlaylist() {
    if (!selectedPlaylist) return
    if (
      await mutate(() =>
        api.music.destinations.save({
          playlistId: selectedPlaylist.id,
          description: "",
          enabled: false,
        })
      )
    ) {
      setSelectedPlaylist(null)
      setPlaylistQuery("")
      setMenuOpen(false)
    }
  }

  async function createPlaylist(name: string) {
    if (
      await mutate(() =>
        api.music.destinations.create({ name, description: "" })
      )
    ) {
      setPlaylistQuery("")
      setSelectedPlaylist(null)
      setMenuOpen(false)
    }
  }

  if (view.kind === "loading")
    return (
      <section aria-label="Playlist settings">
        <Card>
          <CardContent>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden="true" />
              Loading playlist settings…
            </p>
          </CardContent>
        </Card>
      </section>
    )
  if (view.kind === "error")
    return (
      <section aria-label="Playlist settings">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Playlists</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{view.message}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </section>
    )

  const { config, playlists } = view
  const names = new Map(
    playlists.map((playlist) => [playlist.id, playlist.name])
  )
  const configured = new Set(
    config.destinations.map((destination) => destination.playlistId)
  )
  const available = playlists.filter((playlist) => !configured.has(playlist.id))

  return (
    <section aria-label="Playlists">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Playlists</h2>
          </CardTitle>
          <CardDescription>
            Add a playlist, then describe the tracks that belong in it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3">
            <h3 className="font-heading font-medium">Your playlists</h3>
            {config.destinations.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
                No playlists added yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {config.destinations.map((destination) => {
                  const name =
                    names.get(destination.playlistId) ?? destination.playlistId
                  const isEditing = editingId === destination.playlistId
                  const canEnable = Boolean(destination.description.trim())
                  return (
                    <Item
                      key={destination.playlistId}
                      render={<li />}
                      variant="outline"
                    >
                      <ItemContent>
                        <ItemTitle>{name}</ItemTitle>
                        <p
                          className={
                            destination.enabled
                              ? "flex items-center gap-1.5 text-xs text-foreground"
                              : "flex items-center gap-1.5 text-xs text-muted-foreground"
                          }
                        >
                          <span
                            aria-hidden="true"
                            className={
                              destination.enabled
                                ? "size-1.5 rounded-full bg-primary"
                                : "size-1.5 rounded-full bg-muted-foreground/50"
                            }
                          />
                          {destination.enabled
                            ? "Ready for new tracks"
                            : canEnable
                              ? "Paused"
                              : "Add a track description to use this playlist"}
                        </p>
                      </ItemContent>
                      <ItemActions className="flex-wrap">
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setEditingId(
                              isEditing ? null : destination.playlistId
                            )
                            setEditingDescription(destination.description)
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {isEditing ? "Cancel" : "Edit description"}
                        </Button>
                        <Button
                          disabled={
                            busy || (!destination.enabled && !canEnable)
                          }
                          onClick={() =>
                            mutate(() =>
                              api.music.destinations.save({
                                playlistId: destination.playlistId,
                                description: destination.description,
                                enabled: !destination.enabled,
                              })
                            )
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {destination.enabled ? "Pause" : "Use playlist"}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            mutate(() =>
                              api.music.destinations.remove({
                                playlistId: destination.playlistId,
                              })
                            )
                          }
                          size="sm"
                          type="button"
                          variant="destructive"
                        >
                          Remove
                        </Button>
                      </ItemActions>
                      {isEditing ? (
                        <div className="flex basis-full flex-col gap-3">
                          <TrackDescription
                            id={`description-${destination.playlistId}`}
                            value={editingDescription}
                            onChange={setEditingDescription}
                          />
                          <Button
                            className="w-fit"
                            disabled={
                              busy ||
                              (destination.enabled &&
                                !editingDescription.trim())
                            }
                            onClick={async () => {
                              if (
                                await mutate(() =>
                                  api.music.destinations.save({
                                    playlistId: destination.playlistId,
                                    description: editingDescription,
                                    enabled:
                                      destination.enabled ||
                                      (!destination.description.trim() &&
                                        Boolean(editingDescription.trim())),
                                  })
                                )
                              )
                                setEditingId(null)
                            }}
                            type="button"
                          >
                            Save description
                          </Button>
                        </div>
                      ) : destination.description ? (
                        <p className="basis-full whitespace-pre-wrap text-muted-foreground">
                          {destination.description}
                        </p>
                      ) : null}
                    </Item>
                  )
                })}
              </ul>
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="font-heading font-medium">Add playlist</h3>
              <p className="text-muted-foreground">
                Search your Spotify playlists or create a private one.
              </p>
            </div>
            <PlaylistCombobox
              playlists={available}
              value={playlistQuery}
              selected={selectedPlaylist}
              open={menuOpen}
              disabled={busy}
              onValueChange={(value) => {
                setPlaylistQuery(value)
                setSelectedPlaylist(null)
                setMenuOpen(true)
              }}
              onOpenChange={setMenuOpen}
              onSelect={(playlist) => {
                setSelectedPlaylist(playlist)
                setPlaylistQuery(playlist.name)
                setMenuOpen(false)
              }}
              onCreate={(name) => createPlaylist(name)}
            />
            <Button
              className="w-fit"
              disabled={busy || !selectedPlaylist}
              onClick={addSelectedPlaylist}
              type="button"
            >
              Add playlist
            </Button>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="font-heading font-medium">
                Tracks needing review
              </h3>
              <p className="text-muted-foreground">
                Tracks that do not match a playlist description go here.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="review-playlist">
                Spotify playlist
              </FieldLabel>
              <NativeSelect
                className="w-full"
                id="review-playlist"
                value={reviewId}
                onChange={(event) => setReviewId(event.target.value)}
              >
                <NativeSelectOption value="">
                  No review playlist
                </NativeSelectOption>
                {playlists.map((playlist) => (
                  <NativeSelectOption
                    key={playlist.id}
                    value={playlist.id}
                    disabled={config.destinations.some(
                      (destination) =>
                        destination.enabled &&
                        destination.playlistId === playlist.id
                    )}
                  >
                    {playlist.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button
              className="w-fit"
              disabled={busy || reviewId === (config.reviewPlaylistId ?? "")}
              onClick={() =>
                mutate(() =>
                  api.music.destinations.setReviewPlaylist({
                    playlistId: reviewId || null,
                  })
                )
              }
              type="button"
            >
              Save playlist
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function TrackDescription({
  id,
  value,
  onChange,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>Which tracks belong here?</FieldLabel>
      <Textarea
        id={id}
        maxLength={2000}
        rows={3}
        value={value}
        placeholder="For example: mellow acoustic songs for a quiet evening."
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription className="text-xs">
        Describe the sound, mood, or setting. A description is required before
        this playlist can be used.
      </FieldDescription>
    </div>
  )
}
