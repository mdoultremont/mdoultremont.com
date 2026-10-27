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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/features/ui/table"
import { api, errorMessage } from "@/features/api"
import type {
  EnrichmentStatus,
  TagSource,
} from "@mdoultremont/tools-contracts/music"

const pollMilliseconds = 5000

const tagSourceNames: Record<TagSource, string> = {
  lastfm: "Last.fm",
  discogs: "Discogs",
  listenbrainz: "ListenBrainz",
}

/** The Worker secret each tag source needs; ListenBrainz needs none. */
const tagSourceSecrets: Partial<Record<TagSource, string>> = {
  lastfm: "LASTFM_API_KEY",
  discogs: "DISCOGS_TOKEN",
}

/** Lookups still to run: MusicBrainz first, then each tag source. */
function waitingCount(status: EnrichmentStatus) {
  return (
    status.pending +
    status.sources.reduce((total, source) => total + source.pending, 0)
  )
}

/** Lookups "Look up unresolved tracks again" would retry. */
function unresolvedCount(status: EnrichmentStatus) {
  return (
    status.notFound +
    status.ambiguous +
    status.failed +
    status.sources
      .filter((source) => source.configured)
      .reduce((total, source) => total + source.notFound + source.failed, 0)
  )
}

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
  const pending = status ? waitingCount(status) : 0

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
        if (waitingCount(next) > 0) timer = setTimeout(load, pollMilliseconds)
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

  const unresolved = status ? unresolvedCount(status) : 0

  return (
    <section aria-label="Enrichment">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Enrichment</h2>
          </CardTitle>
          <CardDescription>
            Identifies each liked track on MusicBrainz, then adds its
            AcousticBrainz analysis and tags from Last.fm, Discogs, and
            ListenBrainz when they know it. This recording data is the only
            thing classification reads.
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
                {status.pending > 0
                  ? `Looking up recordings: ${status.pending} waiting…`
                  : pending > 0
                    ? `Looking up tags: ${pending} lookups waiting…`
                    : "All liked tracks have been looked up."}
              </output>
              <Coverage status={status} />
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Count
                  label="Matched by title and artist"
                  value={status.matchedBySearch}
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
                Tracks without recording data go to the review playlist. Tags
                from{" "}
                <a
                  className="underline underline-offset-2"
                  href="https://www.last.fm"
                  rel="noreferrer"
                  target="_blank"
                >
                  Last.fm
                </a>{" "}
                and{" "}
                <a
                  className="underline underline-offset-2"
                  href="https://listenbrainz.org"
                  rel="noreferrer"
                  target="_blank"
                >
                  ListenBrainz
                </a>
                . Data provided by{" "}
                <a
                  className="underline underline-offset-2"
                  href="https://www.discogs.com"
                  rel="noreferrer"
                  target="_blank"
                >
                  Discogs
                </a>
                .
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

/** How many tracks with a MusicBrainz recording each other source knows. */
function Coverage({ status }: { readonly status: EnrichmentStatus }) {
  const share = (found: number) =>
    status.enriched > 0
      ? `${Math.round((found / status.enriched) * 100)}%`
      : "–"
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3 font-normal text-muted-foreground">
              Source
            </TableHead>
            <TableHead className="text-right font-normal text-muted-foreground">
              Coverage
            </TableHead>
            <TableHead className="text-right font-normal text-muted-foreground">
              Nothing found
            </TableHead>
            <TableHead className="text-right font-normal text-muted-foreground">
              Failed
            </TableHead>
            <TableHead className="pr-3 text-right font-normal text-muted-foreground">
              Waiting
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          <TableRow>
            <TableCell className="pl-3">AcousticBrainz</TableCell>
            <TableCell className="text-right">
              {status.withAnalysis} · {share(status.withAnalysis)}
            </TableCell>
            <TableCell className="text-right">
              {status.enriched - status.withAnalysis}
            </TableCell>
            <TableCell className="text-right">–</TableCell>
            <TableCell className="pr-3 text-right">–</TableCell>
          </TableRow>
          {status.sources.map((source) => (
            <TableRow key={source.source}>
              <TableCell className="pl-3">
                {tagSourceNames[source.source]}
              </TableCell>
              {source.configured ? (
                <>
                  <TableCell className="text-right">
                    {source.found} · {share(source.found)}
                  </TableCell>
                  <TableCell className="text-right">
                    {source.notFound}
                  </TableCell>
                  <TableCell className="text-right">{source.failed}</TableCell>
                  <TableCell className="pr-3 text-right">
                    {source.pending}
                  </TableCell>
                </>
              ) : (
                <TableCell
                  className="pr-3 text-right text-muted-foreground"
                  colSpan={4}
                >
                  Not configured: set {tagSourceSecrets[source.source]}
                </TableCell>
              )}
            </TableRow>
          ))}
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-3 font-medium">Any tags</TableCell>
            <TableCell className="text-right font-medium">
              {status.withTags} · {share(status.withTags)}
            </TableCell>
            <TableCell className="text-right">
              {status.enriched - status.withTags}
            </TableCell>
            <TableCell />
            <TableCell className="pr-3" />
          </TableRow>
        </TableBody>
      </Table>
    </div>
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
