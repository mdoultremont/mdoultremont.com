import { useEffect, useState } from "react"
import type { EnrichmentStatus } from "@/backend/features/music/enrichment"

const pollMilliseconds = 5000

export function EnrichmentPanel({
  csrfToken,
  initialStatus,
}: {
  readonly csrfToken: string
  readonly initialStatus?: EnrichmentStatus
}) {
  const [status, setStatus] = useState<EnrichmentStatus | null>(
    initialStatus ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = status?.pending ?? 0

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const response = await fetch("/api/music/enrichment")
        if (!response.ok)
          throw new Error("Enrichment status could not be loaded")
        const next = (await response.json()) as EnrichmentStatus
        if (!active) return
        setStatus(next)
        setError(null)
        // Poll only while lookups remain.
        if (next.pending > 0) timer = setTimeout(load, pollMilliseconds)
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Enrichment status could not be loaded"
          )
      }
    }
    if (status === null || pending > 0) void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [pending > 0])

  async function retry() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/music/enrichment", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
      })
      const payload = (await response.json().catch(() => null)) as
        | (EnrichmentStatus & { error?: string })
        | null
      if (!response.ok || !payload)
        throw new Error(payload?.error ?? "Lookups could not be retried")
      setStatus(payload)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Lookups could not be retried"
      )
    } finally {
      setBusy(false)
    }
  }

  const unresolved = status
    ? status.notFound + status.ambiguous + status.failed
    : 0

  return (
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Enrichment"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">Enrichment</h2>
        {status ? (
          <p className="text-sm text-ink/70">
            {status.enriched} with recording data
          </p>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Looks up each liked track on MusicBrainz and AcousticBrainz. This
        recording data is the only thing classification reads.
      </p>

      {status === null && !error ? (
        <p className="mt-3 text-sm text-ink/70">Loading…</p>
      ) : null}
      {status ? (
        <>
          <output className="mt-3 block text-sm text-ink/80">
            {pending > 0
              ? `Looking up recordings: ${pending} waiting…`
              : "All liked tracks have been looked up."}
          </output>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink/70 sm:grid-cols-3">
            <Count
              label="With AcousticBrainz analysis"
              value={status.withAnalysis}
            />
            <Count label="Not on MusicBrainz" value={status.notFound} />
            <Count
              label="Several possible recordings"
              value={status.ambiguous}
            />
            <Count label="Lookup failed" value={status.failed} />
            <Count label="No ISRC from Spotify" value={status.withoutIsrc} />
          </dl>
          <p className="mt-3 text-xs text-ink/50">
            Tracks without recording data go to the review playlist.
          </p>
        </>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
          disabled={busy || unresolved === 0}
          onClick={() => void retry()}
          type="button"
        >
          Look up unresolved tracks again
        </button>
      </div>
    </section>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  )
}
