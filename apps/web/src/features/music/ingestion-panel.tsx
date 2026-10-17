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
import type {
  IngestionKind,
  IngestionStatus,
} from "@/server/actions/music/ingestion"

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
        const response = await fetch("/api/apps/music/ingestion")
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
      const response = await fetch("/api/apps/music/ingestion", {
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
    <section aria-label="Ingestion">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Ingestion</h2>
          </CardTitle>
          <CardDescription>
            Reads your Spotify Liked Songs. New likes are checked every hour,
            and every like once a day.
          </CardDescription>
          {status ? (
            <CardAction>
              <Badge variant="secondary">
                {status.liked} liked
                {status.unliked > 0 ? ` · ${status.unliked} un-liked` : ""}
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
          {latest ? (
            <output className="block">{describe(latest)}</output>
          ) : status ? (
            <p className="text-muted-foreground">No likes ingested yet.</p>
          ) : null}
          {latest?.status === "failed" && latest.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{latest.error}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || inProgress}
              onClick={() => void start("incremental")}
              type="button"
              variant="outline"
            >
              Check for new likes
            </Button>
            <Button
              disabled={busy || inProgress}
              onClick={() => void start("full")}
              type="button"
              variant="outline"
            >
              Re-read all likes
            </Button>
          </div>
        </CardContent>
      </Card>
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
