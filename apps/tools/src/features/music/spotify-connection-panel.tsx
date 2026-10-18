import { CircleAlertIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button, buttonVariants } from "@/features/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/features/ui/card"
import { Spinner } from "@/features/ui/spinner"
import { api } from "@/features/api"
import { errorReason } from "@/shared/actions"
import type { SpotifyConnectionStatus, SpotifyPlaylist } from "@/shared/music"

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: SpotifyConnectionStatus }

/** Spotify account controls. `children`, the rest of the music app, show only once Spotify is connected. */
export function SpotifyConnectionPanel({
  initialConnection,
  children,
}: {
  readonly initialConnection?: SpotifyConnectionStatus
  readonly children?: ReactNode
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
    api.music.spotify
      .status()
      .then((connection) => {
        if (active) setState({ kind: "ready", connection })
      })
      .catch(() => {
        if (active)
          setState({
            kind: "error",
            message: "Connection status could not be loaded",
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
      setPlaylists((await api.music.spotify.playlists()).items)
    } catch (error) {
      if (errorReason(error) === "ReconnectNeeded") await refreshStatus()
      else setActionError("Playlists could not be loaded")
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setActionError(null)
    try {
      await api.music.spotify.disconnect()
      setState({ kind: "ready", connection: { status: "disconnected" } })
      setPlaylists(null)
    } catch {
      setActionError("Spotify could not be disconnected")
    } finally {
      setBusy(false)
    }
  }

  async function refreshStatus() {
    try {
      setState({ kind: "ready", connection: await api.music.spotify.status() })
    } catch {
      setActionError("Connection status could not be loaded")
    }
  }

  const connection = state.kind === "ready" ? state.connection : null
  const message =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("spotify")

  const alerts = (
    <>
      {message === "failed" || message === "denied" ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>
            Spotify authorization could not be completed. Please try again.
          </AlertDescription>
        </Alert>
      ) : null}
      {state.kind === "error" ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
    </>
  )

  if (connection?.status !== "connected")
    return (
      <section
        aria-label="Spotify connection"
        className="flex flex-col items-start gap-4"
      >
        {alerts}
        {state.kind === "loading" ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner aria-hidden="true" />
            Checking connection…
          </p>
        ) : null}
        {connection ? (
          <a
            className={buttonVariants({ size: "lg" })}
            href="/api/music/spotify/connect"
          >
            {connection.status === "reconnect_needed"
              ? "Reconnect Spotify"
              : "Connect Spotify"}
          </a>
        ) : null}
      </section>
    )

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Spotify connection">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Spotify</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {alerts}
            <p className="text-muted-foreground">
              Connected as{" "}
              <strong className="font-medium text-foreground">
                {connection.displayName ?? connection.accountId}
              </strong>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={loadPlaylists}
                type="button"
                variant="outline"
              >
                View playlists
              </Button>
              <Button
                disabled={busy}
                onClick={disconnect}
                type="button"
                variant="outline"
              >
                Disconnect Spotify
              </Button>
            </div>
            {playlists ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-heading font-medium">Playlists</h3>
                <ul className="max-h-72 divide-y overflow-auto rounded-lg border">
                  {playlists.map((playlist) => (
                    <li className="px-3 py-2" key={playlist.id}>
                      {playlist.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
      {children}
    </div>
  )
}
