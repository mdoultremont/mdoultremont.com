import { useEffect, useState } from "react"
import type { SpotifyPlaylist } from "../backend/modules/spotify"
import type { DestinationConfiguration } from "../backend/workflows/destinations"

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
  const [playlistId, setPlaylistId] = useState("")
  const [description, setDescription] = useState("")
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
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

  if (view.kind === "loading")
    return (
      <section className="mt-6" aria-label="Playlist destinations">
        <p>Loading playlist settings…</p>
      </section>
    )
  if (view.kind === "error")
    return (
      <section className="mt-6" aria-label="Playlist destinations">
        <h2 className="text-lg font-semibold">Playlist destinations</h2>
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
      aria-label="Playlist destinations"
    >
      <h2 className="text-lg font-semibold text-ink">Playlist destinations</h2>
      <p className="mt-2 text-sm leading-6 text-ink/70">
        Descriptions here tell the classifier when to use each playlist. Spotify
        playlist descriptions do not affect these rules.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <h3 className="mt-6 font-medium">Configured destinations</h3>
      {config.destinations.length === 0 ? (
        <p className="mt-2 text-sm text-ink/60">
          No destinations configured yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {config.destinations.map((destination) => (
            <li
              className="rounded-xl border border-ink/10 p-4"
              key={destination.playlistId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {names.get(destination.playlistId) ??
                      destination.playlistId}
                  </p>
                  <p className="text-xs text-ink/50">
                    {destination.enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
                <div className="flex gap-3 text-sm">
                  <button
                    type="button"
                    className="underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(destination.playlistId)
                      setEditingDescription(destination.description)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() =>
                      mutate("/api/music/destinations", "PUT", {
                        playlistId: destination.playlistId,
                        description: destination.description,
                        enabled: !destination.enabled,
                      })
                    }
                  >
                    {destination.enabled ? "Disable" : "Enable"}
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
              {editingId === destination.playlistId ? (
                <div className="mt-3">
                  <label
                    className="block text-sm"
                    htmlFor={`description-${destination.playlistId}`}
                  >
                    Classification description
                  </label>
                  <textarea
                    id={`description-${destination.playlistId}`}
                    className="mt-1 w-full rounded-lg border border-ink/20 p-2 text-sm"
                    maxLength={2000}
                    rows={3}
                    value={editingDescription}
                    onChange={(event) =>
                      setEditingDescription(event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="mt-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
                    disabled={busy || !editingDescription.trim()}
                    onClick={async () => {
                      if (
                        await mutate("/api/music/destinations", "PUT", {
                          playlistId: destination.playlistId,
                          description: editingDescription,
                          enabled: destination.enabled,
                        })
                      )
                        setEditingId(null)
                    }}
                  >
                    Save description
                  </button>
                </div>
              ) : (
                <p className="mt-3 whitespace-pre-wrap text-sm text-ink/70">
                  {destination.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 border-t border-ink/10 pt-6">
        <h3 className="font-medium">Attach an existing playlist</h3>
        <label className="mt-3 block text-sm" htmlFor="existing-playlist">
          Spotify playlist
        </label>
        <select
          id="existing-playlist"
          className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-sm"
          value={playlistId}
          onChange={(event) => setPlaylistId(event.target.value)}
        >
          <option value="">Choose a playlist</option>
          {available.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name}
            </option>
          ))}
        </select>
        <label className="mt-3 block text-sm" htmlFor="existing-description">
          Classification description
        </label>
        <textarea
          id="existing-description"
          className="mt-1 w-full rounded-lg border border-ink/20 p-2 text-sm"
          maxLength={2000}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <button
          type="button"
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
          disabled={busy || !playlistId || !description.trim()}
          onClick={async () => {
            if (
              await mutate("/api/music/destinations", "PUT", {
                playlistId,
                description,
                enabled: true,
              })
            ) {
              setPlaylistId("")
              setDescription("")
            }
          }}
        >
          Attach destination
        </button>
      </div>

      <div className="mt-7 border-t border-ink/10 pt-6">
        <h3 className="font-medium">Create a private playlist</h3>
        <label className="mt-3 block text-sm" htmlFor="new-playlist-name">
          Playlist name
        </label>
        <input
          id="new-playlist-name"
          className="mt-1 w-full rounded-lg border border-ink/20 p-2 text-sm"
          maxLength={100}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <label
          className="mt-3 block text-sm"
          htmlFor="new-playlist-description"
        >
          Classification description
        </label>
        <textarea
          id="new-playlist-description"
          className="mt-1 w-full rounded-lg border border-ink/20 p-2 text-sm"
          maxLength={2000}
          rows={3}
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
        />
        <button
          type="button"
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
          disabled={busy || !newName.trim() || !newDescription.trim()}
          onClick={async () => {
            if (
              await mutate("/api/music/destinations/create", "POST", {
                name: newName,
                description: newDescription,
              })
            ) {
              setNewName("")
              setNewDescription("")
            }
          }}
        >
          Create and configure
        </button>
      </div>

      <div className="mt-7 border-t border-ink/10 pt-6">
        <h3 className="font-medium">Review playlist</h3>
        <p className="mt-1 text-sm text-ink/70">
          Tracks without an accepted destination go here.
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
          Save review playlist
        </button>
      </div>
    </section>
  )
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
