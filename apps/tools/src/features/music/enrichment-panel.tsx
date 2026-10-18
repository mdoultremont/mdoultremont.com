import { CircleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
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
import { api, errorMessage } from "@/features/api"
import type { EnrichmentStatus } from "@/shared/music"

const pollMilliseconds = 5000

export function EnrichmentPanel({
  initialStatus,
}: {
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
        const next = await api.music.enrichment.status()
        if (!active) return
        setStatus(next)
        setError(null)
        // Poll only while lookups remain.
        if (next.pending > 0) timer = setTimeout(load, pollMilliseconds)
      } catch {
        if (active) setError("Enrichment status could not be loaded")
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
      setStatus(await api.music.enrichment.retry())
    } catch (cause) {
      setError(errorMessage(cause, "Lookups could not be retried"))
    } finally {
      setBusy(false)
    }
  }

  const unresolved = status
    ? status.notFound + status.ambiguous + status.failed
    : 0

  return (
    <section aria-label="Enrichment">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Enrichment</h2>
          </CardTitle>
          <CardDescription>
            Looks up each liked track on MusicBrainz and AcousticBrainz. This
            recording data is the only thing classification reads.
          </CardDescription>
          {status ? (
            <CardAction>
              <Badge variant="secondary">
                {status.enriched} with recording data
              </Badge>
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
              <output className="block">
                {pending > 0
                  ? `Looking up recordings: ${pending} waiting…`
                  : "All liked tracks have been looked up."}
              </output>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                <Count
                  label="No ISRC from Spotify"
                  value={status.withoutIsrc}
                />
              </dl>
              <p className="text-xs text-muted-foreground">
                Tracks without recording data go to the review playlist.
              </p>
            </>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || unresolved === 0}
              onClick={() => void retry()}
              type="button"
              variant="outline"
            >
              Look up unresolved tracks again
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading text-lg font-medium tabular-nums">{value}</dd>
    </div>
  )
}
