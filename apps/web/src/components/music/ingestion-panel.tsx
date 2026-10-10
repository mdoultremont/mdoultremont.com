import { useEffect, useState } from "react"
import type {
  IngestionKind,
  IngestionStatus,
} from "@/backend/features/music/ingestion"

const pollMilliseconds = 3000

export function IngestionPanel({
  initialStatus,
}: {
  readonly initialStatus?: IngestionStatus
}) {
  const [status, setStatus] = useState<IngestionStatus | null>(
    initialStatus ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = status?.latest ?? null
  const inProgress = latest?.status === "queued" || latest?.status === "running"

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const response = await fetch("/api/music/ingestion")
        if (!response.ok)
          throw new Error("Ingestion status could not be loaded")
        const next = (await response.json()) as IngestionStatus
        if (!active) return
        setStatus(next)
        setError(null)
        if (
          next.latest?.status === "queued" ||
          next.latest?.status === "running"
        )
          timer = setTimeout(load, pollMilliseconds)
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Ingestion status could not be loaded"
          )
      }
    }
    // Load once on mount, then poll while an ingestion is in progress.
    if (status === null || inProgress) void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [latest?.id, inProgress])

  async function start(kind: IngestionKind) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/music/ingestion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok)
        throw new Error(payload?.error ?? "Ingestion could not be started")
      setStatus((current) => ({
        liked: current?.liked ?? 0,
        unliked: current?.unliked ?? 0,
        latest: payload as IngestionStatus["latest"],
      }))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Ingestion could not be started"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Ingestion"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">Ingestion</h2>
        {status ? (
          <p className="text-sm text-ink/70">
            {status.liked} liked
            {status.unliked > 0 ? ` · ${status.unliked} un-liked` : ""}
          </p>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Reads your Spotify Liked Songs. New likes are checked every hour, and
        every like once a day.
      </p>

      {status === null && !error ? (
        <p className="mt-3 text-sm text-ink/70">Loading…</p>
      ) : null}
      {latest ? (
        <output className="mt-3 block text-sm text-ink/80">
          {describe(latest)}
        </output>
      ) : status ? (
        <p className="mt-3 text-sm text-ink/80">No likes ingested yet.</p>
      ) : null}
      {latest?.status === "failed" && latest.error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {latest.error}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
          disabled={busy || inProgress}
          onClick={() => void start("incremental")}
          type="button"
        >
          Check for new likes
        </button>
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
          disabled={busy || inProgress}
          onClick={() => void start("full")}
          type="button"
        >
          Re-read all likes
        </button>
      </div>
    </section>
  )
}

function describe(ingestion: NonNullable<IngestionStatus["latest"]>) {
  const scope = ingestion.kind === "full" ? "all likes" : "new likes"
  const progress =
    ingestion.total === null
      ? `${ingestion.seen} likes read`
      : `${ingestion.seen} of ${ingestion.total} likes read`
  switch (ingestion.status) {
    case "queued":
      return `Waiting to read ${scope}…`
    case "running":
      return `Reading ${scope}: ${progress}…`
    case "completed":
      return [
        `Read ${scope} ${formatTime(ingestion.finishedAt)}`,
        `${ingestion.added} new`,
        ...(ingestion.unliked > 0 ? [`${ingestion.unliked} un-liked`] : []),
      ].join(" · ")
    case "failed":
      return `Reading ${scope} stopped after ${progress}.`
  }
}

function formatTime(timestamp: number | null) {
  if (timestamp === null) return ""
  return `on ${new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}`
}
