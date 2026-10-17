import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type {
  ClassificationStatus,
  DecisionSummary,
} from "@/server/actions/music/classification"
import type { SpotifyPlaylist } from "@/server/modules/spotify"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import { Spinner } from "@/features/ui/spinner"

const pollMilliseconds = 5000

export function ClassificationPanel({
  initialStatus,
  initialPlaylistNames,
}: {
  readonly initialStatus?: ClassificationStatus
  readonly initialPlaylistNames?: Readonly<Record<string, string>>
}) {
  const [status, setStatus] = useState<ClassificationStatus | null>(
    initialStatus ?? null
  )
  const [playlistNames, setPlaylistNames] = useState<
    Readonly<Record<string, string>>
  >(initialPlaylistNames ?? {})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const working =
    status !== null &&
    status.ready &&
    (status.pending > 0 || status.waitingForEnrichment > 0)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const response = await fetch("/api/music/classification")
        if (!response.ok)
          throw new Error("Classification status could not be loaded")
        const next = (await response.json()) as ClassificationStatus
        if (!active) return
        setStatus(next)
        setError(null)
        if (next.ready && (next.pending > 0 || next.waitingForEnrichment > 0))
          timer = setTimeout(load, pollMilliseconds)
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Classification status could not be loaded"
          )
      }
    }
    if (status === null || working) void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [working])

  // Playlist names make decisions readable; IDs are shown if they cannot load.
  useEffect(() => {
    if (initialPlaylistNames) return
    let active = true
    fetch("/api/music/spotify/playlists")
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ items: SpotifyPlaylist[] }>)
          : { items: [] }
      )
      .then(({ items }) => {
        if (active)
          setPlaylistNames(
            Object.fromEntries(items.map((item) => [item.id, item.name]))
          )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [initialPlaylistNames])

  async function send(
    url: string,
    init: RequestInit,
    failure: string
  ): Promise<unknown> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
        },
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) throw new Error(payload?.error ?? failure)
      return payload
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function setReady(ready: boolean) {
    const result = await send(
      "/api/music/ready",
      { method: "PUT", body: JSON.stringify({ ready }) },
      "Classification could not be changed"
    )
    if (result && status) setStatus({ ...status, ready })
  }

  async function reclassify() {
    const result = await send(
      "/api/music/classification",
      { method: "POST" },
      "Reclassification could not start"
    )
    if (result) setStatus(result as ClassificationStatus)
  }

  return (
    <section aria-label="Classification">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Classification</h2>
          </CardTitle>
          <CardDescription>
            Jev reads each track's recording data and your playlist
            descriptions, and picks the playlists it belongs to. Nothing is
            written to Spotify here.
          </CardDescription>
          {status ? (
            <CardAction>
              <Badge variant="secondary">{status.decided} decided</Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status === null && !error ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden="true" />
              Loading…
            </p>
          ) : null}
          {status ? (
            <>
              <output className="block">{describe(status)}</output>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Count label="To playlists" value={status.toDestinations} />
                <Count label="To review" value={status.toReview} />
                <Count
                  label="No recording data"
                  value={status.withoutRecordingData}
                />
                <Count
                  label="Waiting for enrichment"
                  value={status.waitingForEnrichment}
                />
              </dl>
              {status.outdated > 0 ? (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-amber-800 dark:text-amber-300">
                  <TriangleAlertIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>
                    {status.outdated} decisions were made before your playlists
                    changed. Reclassify to update them.
                  </span>
                </p>
              ) : null}
            </>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {status ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => void setReady(!status.ready)}
                type="button"
                variant={status.ready ? "outline" : "default"}
              >
                {status.ready
                  ? "Pause classification"
                  : "Ready: start classifying"}
              </Button>
              <Button
                disabled={busy || !status.ready || status.decided === 0}
                onClick={() => void reclassify()}
                type="button"
                variant="outline"
              >
                Reclassify all tracks
              </Button>
            </div>
          ) : null}

          {status && status.recent.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-heading font-medium">Latest decisions</h3>
              <ul className="max-h-80 divide-y overflow-auto rounded-lg border">
                {status.recent.map((decision) => (
                  <Decision
                    decision={decision}
                    key={decision.trackId}
                    playlistNames={playlistNames}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function Decision({
  decision,
  playlistNames,
}: {
  readonly decision: DecisionSummary
  readonly playlistNames: Readonly<Record<string, string>>
}) {
  const name = (id: string) => playlistNames[id] ?? id
  const best = Object.entries(decision.probabilities).reduce<
    [string, number] | undefined
  >((top, entry) => (top && top[1] >= entry[1] ? top : entry), undefined)
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
      <span className="font-medium">
        {decision.name}
        <span className="font-normal text-muted-foreground">
          {" "}
          · {decision.artistNames.join(", ")}
        </span>
      </span>
      <span
        className={decision.review ? "text-muted-foreground" : "tabular-nums"}
      >
        {decision.review
          ? decision.reason === "no_recording_data"
            ? "Review (no recording data)"
            : decision.reason === "classifier_failed"
              ? "Review (Jev could not answer)"
              : best
                ? `Review (best: ${name(best[0])} ${percent(best[1])})`
                : "Review"
          : decision.destinationIds
              .map(
                (id) =>
                  `${name(id)} ${percent(decision.probabilities[id] ?? 0)}`
              )
              .join(", ")}
      </span>
    </li>
  )
}

function describe(status: ClassificationStatus) {
  if (!status.ready)
    return "Paused. Set up your playlists and descriptions, then mark them ready."
  if (status.pending > 0)
    return `Classifying: ${status.pending} tracks waiting…`
  if (status.waitingForEnrichment > 0)
    return `Waiting for enrichment of ${status.waitingForEnrichment} tracks.`
  return "Every liked track has a decision."
}

function percent(probability: number) {
  return `${Math.round(probability * 100)}%`
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading text-lg font-medium tabular-nums">{value}</dd>
    </div>
  )
}
