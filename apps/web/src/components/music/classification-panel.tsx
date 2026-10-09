import { useEffect, useState } from "react"
import type {
  ClassificationStatus,
  DecisionSummary,
} from "@/backend/features/music/classification"
import type { SpotifyPlaylist } from "@/backend/modules/spotify"

const pollMilliseconds = 5000

export function ClassificationPanel({
  csrfToken,
  initialStatus,
  initialPlaylistNames,
}: {
  readonly csrfToken: string
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
    fetch("/api/spotify/playlists")
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
          "X-CSRF-Token": csrfToken,
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
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Classification"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">Classification</h2>
        {status ? (
          <p className="text-sm text-ink/70">{status.decided} decided</p>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Jev reads each track's recording data and your playlist descriptions,
        and picks the playlists it belongs to. Nothing is written to Spotify
        here.
      </p>

      {status === null && !error ? (
        <p className="mt-3 text-sm text-ink/70">Loading…</p>
      ) : null}
      {status ? (
        <>
          <output className="mt-3 block text-sm text-ink/80">
            {describe(status)}
          </output>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink/70 sm:grid-cols-3">
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
            <p className="mt-3 text-sm text-amber-800">
              {status.outdated} decisions were made before your playlists
              changed. Reclassify to update them.
            </p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {status ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className={
              status.ready
                ? "rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
                : "rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
            }
            disabled={busy}
            onClick={() => void setReady(!status.ready)}
            type="button"
          >
            {status.ready ? "Pause classification" : "Ready: start classifying"}
          </button>
          <button
            className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy || !status.ready || status.decided === 0}
            onClick={() => void reclassify()}
            type="button"
          >
            Reclassify all tracks
          </button>
        </div>
      ) : null}

      {status && status.recent.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-ink">Latest decisions</h3>
          <ul className="mt-2 max-h-80 divide-y divide-ink/5 overflow-auto text-sm">
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
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
      <span className="text-ink">
        {decision.name}
        <span className="text-ink/50">
          {" "}
          · {decision.artistNames.join(", ")}
        </span>
      </span>
      <span className="text-ink/70">
        {decision.review
          ? decision.reason === "no_recording_data"
            ? "Review (no recording data)"
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
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  )
}
