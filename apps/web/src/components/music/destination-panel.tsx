import { Combobox } from "@base-ui/react/combobox"
import { useEffect, useId, useState } from "react"
import type { SpotifyPlaylist } from "@/backend/modules/spotify"
import type { DestinationConfiguration } from "@/backend/features/music/destinations"

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready"
      readonly config: DestinationConfiguration
      readonly playlists: readonly SpotifyPlaylist[]
    }

export function DestinationPanel({
  csrfToken,
}: {
  readonly csrfToken: string
}) {
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
    Promise.all([
      readJson<DestinationConfiguration>("/api/music/destinations"),
      readJson<{ items: SpotifyPlaylist[] }>("/api/spotify/playlists"),
    ])
      .then(([config, playlists]) => {
        if (!active) return
        setView({ kind: "ready", config, playlists: playlists.items })
        setReviewId(config.reviewPlaylistId ?? "")
      })
      .catch((cause: unknown) => {
        if (active) setView({ kind: "error", message: message(cause) })
      })
    return () => {
      active = false
    }
  }, [])

  async function refresh() {
    const config = await readJson<DestinationConfiguration>(
      "/api/music/destinations"
    )
    const playlists = await readJson<{ items: SpotifyPlaylist[] }>(
      "/api/spotify/playlists"
    )
    setView({ kind: "ready", config, playlists: playlists.items })
    setReviewId(config.reviewPlaylistId ?? "")
  }

  async function mutate(
    url: string,
    method: "POST" | "PUT" | "DELETE",
    body: unknown
  ) {
    setBusy(true)
    setError(null)
    try {
      await readJson(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      })
      try {
        await refresh()
      } catch {
        setError(
          "Saved, but the latest playlist settings could not be loaded. Refresh this page to check them."
        )
      }
      return true
    } catch (cause) {
      setError(message(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addSelectedPlaylist() {
    if (!selectedPlaylist) return
    if (
      await mutate("/api/music/destinations", "PUT", {
        playlistId: selectedPlaylist.id,
        description: "",
        enabled: false,
      })
    ) {
      setSelectedPlaylist(null)
      setPlaylistQuery("")
      setMenuOpen(false)
    }
  }

  async function createPlaylist(name: string) {
    if (
      await mutate("/api/music/destinations/create", "POST", {
        name,
        description: "",
      })
    ) {
      setPlaylistQuery("")
      setSelectedPlaylist(null)
      setMenuOpen(false)
    }
  }

  if (view.kind === "loading")
    return (
      <section className="mt-6" aria-label="Playlist settings">
        <p>Loading playlist settings…</p>
      </section>
    )
  if (view.kind === "error")
    return (
      <section className="mt-6" aria-label="Playlist settings">
        <h2 className="text-lg font-semibold">Playlists</h2>
        <p className="mt-3 text-sm text-red-800" role="alert">
          {view.message}
        </p>
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
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Playlists"
    >
      <h2 className="text-lg font-semibold text-ink">Playlists</h2>
      <p className="mt-2 text-sm leading-6 text-ink/70">
        Add a playlist, then describe the tracks that belong in it.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <h3 className="mt-6 font-medium">Your playlists</h3>
      {config.destinations.length === 0 ? (
        <p className="mt-2 text-sm text-ink/60">No playlists added yet.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {config.destinations.map((destination) => {
            const name =
              names.get(destination.playlistId) ?? destination.playlistId
            const isEditing = editingId === destination.playlistId
            const canEnable = Boolean(destination.description.trim())
            return (
              <li
                className="rounded-xl border border-ink/10 p-4"
                key={destination.playlistId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-xs text-ink/50">
                      {destination.enabled
                        ? "Ready for new tracks"
                        : canEnable
                          ? "Paused"
                          : "Add a track description to use this playlist"}
                    </p>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <button
                      type="button"
                      className="underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(isEditing ? null : destination.playlistId)
                        setEditingDescription(destination.description)
                      }}
                    >
                      {isEditing ? "Cancel" : "Edit description"}
                    </button>
                    <button
                      type="button"
                      className="underline disabled:opacity-50"
                      disabled={busy || (!destination.enabled && !canEnable)}
                      onClick={() =>
                        mutate("/api/music/destinations", "PUT", {
                          playlistId: destination.playlistId,
                          description: destination.description,
                          enabled: !destination.enabled,
                        })
                      }
                    >
                      {destination.enabled ? "Pause" : "Use playlist"}
                    </button>
                    <button
                      type="button"
                      className="underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        mutate("/api/music/destinations", "DELETE", {
                          playlistId: destination.playlistId,
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="mt-3">
                    <TrackDescription
                      id={`description-${destination.playlistId}`}
                      value={editingDescription}
                      onChange={setEditingDescription}
                    />
                    <button
                      type="button"
                      className="mt-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                      disabled={
                        busy ||
                        (destination.enabled && !editingDescription.trim())
                      }
                      onClick={async () => {
                        if (
                          await mutate("/api/music/destinations", "PUT", {
                            playlistId: destination.playlistId,
                            description: editingDescription,
                            enabled:
                              destination.enabled ||
                              (!destination.description.trim() &&
                                Boolean(editingDescription.trim())),
                          })
                        )
                          setEditingId(null)
                      }}
                    >
                      Save description
                    </button>
                  </div>
                ) : destination.description ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-ink/70">
                    {destination.description}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-7 border-t border-ink/10 pt-6">
        <h3 className="font-medium">Add playlist</h3>
        <p className="mt-1 text-sm text-ink/70">
          Search your Spotify playlists or create a private one.
        </p>
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
        <button
          type="button"
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
          disabled={busy || !selectedPlaylist}
          onClick={addSelectedPlaylist}
        >
          Add playlist
        </button>
      </div>

      <div className="mt-7 border-t border-ink/10 pt-6">
        <h3 className="font-medium">Tracks needing review</h3>
        <p className="mt-1 text-sm text-ink/70">
          Tracks that do not match a playlist description go here.
        </p>
        <label className="mt-3 block text-sm" htmlFor="review-playlist">
          Spotify playlist
        </label>
        <select
          id="review-playlist"
          className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-sm"
          value={reviewId}
          onChange={(event) => setReviewId(event.target.value)}
        >
          <option value="">No review playlist</option>
          {playlists.map((playlist) => (
            <option
              key={playlist.id}
              value={playlist.id}
              disabled={config.destinations.some(
                (destination) =>
                  destination.enabled && destination.playlistId === playlist.id
              )}
            >
              {playlist.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
          disabled={busy || reviewId === (config.reviewPlaylistId ?? "")}
          onClick={() =>
            mutate("/api/music/review-playlist", "PUT", {
              playlistId: reviewId || null,
            })
          }
        >
          Save playlist
        </button>
      </div>
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
    <>
      <label className="block text-sm" htmlFor={id}>
        Which tracks belong here?
      </label>
      <textarea
        id={id}
        className="mt-1 w-full rounded-lg border border-ink/20 p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        maxLength={2000}
        rows={3}
        value={value}
        placeholder="For example: mellow acoustic songs for a quiet evening."
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="mt-1 text-xs text-ink/60">
        Describe the sound, mood, or setting. A description is required before
        this playlist can be used.
      </p>
    </>
  )
}

function PlaylistCombobox({
  playlists,
  value,
  selected,
  open,
  disabled,
  onValueChange,
  onOpenChange,
  onSelect,
  onCreate,
}: {
  readonly playlists: readonly SpotifyPlaylist[]
  readonly value: string
  readonly selected: SpotifyPlaylist | null
  readonly open: boolean
  readonly disabled: boolean
  readonly onValueChange: (value: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (playlist: SpotifyPlaylist) => void
  readonly onCreate: (name: string) => void
}) {
  const generatedId = useId()
  const inputId = `${generatedId}-input`
  const query = value.trim().toLocaleLowerCase()
  const matches = playlists.filter((playlist) =>
    playlist.name.toLocaleLowerCase().includes(query)
  )
  const canCreate = Boolean(value.trim()) && matches.length === 0
  const options: PlaylistOption[] = matches.map((playlist) => ({
    kind: "playlist",
    playlist,
    label: playlist.name,
  }))
  if (canCreate)
    options.push({
      kind: "create",
      name: value.trim(),
      label: `Create “${value.trim()}”`,
    })
  const selectedOption: PlaylistOption | null = selected
    ? { kind: "playlist", playlist: selected, label: selected.name }
    : null

  return (
    <Combobox.Root<PlaylistOption>
      autoComplete="list"
      disabled={disabled}
      filter={null}
      inputValue={value}
      isItemEqualToValue={(option, candidate) => {
        if (option.kind === "create" && candidate.kind === "create")
          return option.name === candidate.name
        if (option.kind === "playlist" && candidate.kind === "playlist")
          return option.playlist.id === candidate.playlist.id
        return false
      }}
      itemToStringLabel={(option) => option.label}
      items={options}
      onInputValueChange={(nextValue, details) => {
        if (details.reason === "input-change") onValueChange(nextValue)
      }}
      onOpenChange={onOpenChange}
      open={open}
      value={selectedOption}
    >
      <div className="relative mt-3">
        <label className="block text-sm" htmlFor={inputId}>
          Search Spotify playlists
        </label>
        <Combobox.Input
          id={inputId}
          className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          placeholder="Type a playlist name"
        />
        <Combobox.Portal>
          <Combobox.Positioner className="z-10 outline-none" sideOffset={4}>
            <Combobox.Popup className="max-h-60 w-[var(--anchor-width)] overflow-auto rounded-lg border border-ink/20 bg-white py-1 shadow-lg">
              <Combobox.Empty className="px-3 py-2 text-sm text-ink/60">
                No matching playlists
              </Combobox.Empty>
              <Combobox.List>
                {(option: PlaylistOption) => (
                  <Combobox.Item
                    key={
                      option.kind === "create"
                        ? `create-${option.name}`
                        : option.playlist.id
                    }
                    value={option}
                    className="cursor-pointer px-3 py-2 text-sm outline-none hover:bg-ink/5 data-highlighted:bg-ink/5"
                    onClick={() => {
                      if (option.kind === "create") onCreate(option.name)
                      else onSelect(option.playlist)
                    }}
                  >
                    {option.label}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </div>
    </Combobox.Root>
  )
}

type PlaylistOption =
  | {
      readonly kind: "playlist"
      readonly playlist: SpotifyPlaylist
      readonly label: string
    }
  | {
      readonly kind: "create"
      readonly name: string
      readonly label: string
    }

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body ? body.error : null
    throw new Error(
      typeof error === "string"
        ? error
        : "Playlist settings could not be loaded"
    )
  }
  return body as T
}

function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Playlist settings could not be saved"
}
