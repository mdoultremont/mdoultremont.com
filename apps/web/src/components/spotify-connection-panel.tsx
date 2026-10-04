import { useEffect, useState } from "react"
import type {
  SpotifyConnectionStatus,
  SpotifyPlaylist,
} from "@/backend/modules/spotify"

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: SpotifyConnectionStatus }

export function SpotifyConnectionPanel({
  csrfToken,
  initialConnection,
}: {
  readonly csrfToken: string
  readonly initialConnection?: SpotifyConnectionStatus
}) {
  const [state, setState] = useState<LoadState>(
    initialConnection
      ? { kind: "ready", connection: initialConnection }
      : { kind: "loading" }
  )
  const [playlists, setPlaylists] = useState<readonly SpotifyPlaylist[] | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch("/api/spotify/status")
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Connection status could not be loaded")
        return response.json() as Promise<SpotifyConnectionStatus>
      })
      .then((connection) => {
        if (active) setState({ kind: "ready", connection })
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Connection status could not be loaded",
          })
      })
    return () => {
      active = false
    }
  }, [])

  async function loadPlaylists() {
    setBusy(true)
    setActionError(null)
    try {
      const response = await fetch("/api/spotify/playlists")
      if (response.status === 401) {
        await refreshStatus()
        return
      }
      if (!response.ok) throw new Error("Playlists could not be loaded")
      const payload = (await response.json()) as { items: SpotifyPlaylist[] }
      setPlaylists(payload.items)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Playlists could not be loaded"
      )
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setActionError(null)
    try {
      const response = await fetch("/api/spotify/disconnect", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
      })
      if (!response.ok) throw new Error("Spotify could not be disconnected")
      setState({ kind: "ready", connection: { status: "disconnected" } })
      setPlaylists(null)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Spotify could not be disconnected"
      )
    } finally {
      setBusy(false)
    }
  }

  async function refreshStatus() {
    const response = await fetch("/api/spotify/status")
    if (!response.ok) throw new Error("Connection status could not be loaded")
    const connection = (await response.json()) as SpotifyConnectionStatus
    setState({ kind: "ready", connection })
  }

  const connection = state.kind === "ready" ? state.connection : null
  const message =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("spotify")

  return (
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Spotify connection"
    >
      <h2 className="text-lg font-semibold text-ink">Spotify</h2>
      {message === "failed" || message === "denied" ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          Spotify authorization could not be completed. Please try again.
        </p>
      ) : null}
      {state.kind === "loading" ? (
        <p className="mt-3 text-sm text-ink/70">Checking connection…</p>
      ) : null}
      {state.kind === "error" ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {state.message}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {actionError}
        </p>
      ) : null}
      {connection?.status === "disconnected" ||
      connection?.status === "reconnect_needed" ? (
        <div className="mt-3">
          <p className="text-sm text-ink/70">
            {connection.status === "reconnect_needed"
              ? "Spotify authorization has expired or been revoked."
              : "No Spotify account is connected."}
          </p>
          <a
            className="mt-4 inline-flex rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper"
            href="/api/spotify/connect"
          >
            {connection.status === "reconnect_needed"
              ? "Reconnect Spotify"
              : "Connect Spotify"}
          </a>
        </div>
      ) : null}
      {connection?.status === "connected" ? (
        <div className="mt-3">
          <p className="text-sm text-ink/70">
            Connected as{" "}
            <strong>{connection.displayName ?? connection.accountId}</strong>.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={loadPlaylists}
              type="button"
            >
              View playlists
            </button>
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={disconnect}
              type="button"
            >
              Disconnect Spotify
            </button>
          </div>
          {playlists ? (
            <div className="mt-5">
              <h3 className="font-medium">Playlists</h3>
              <ul className="mt-2 max-h-72 overflow-auto text-sm">
                {playlists.map((playlist) => (
                  <li className="py-1" key={playlist.id}>
                    {playlist.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
