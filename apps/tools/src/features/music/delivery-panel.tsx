import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import type { DeliveryStatus } from "@mdoultremont/tools-contracts/music"
import { api, errorMessage } from "@/features/api"
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
/** Polls without progress before giving up, e.g. while Spotify rate-limits. */
const maxStalledPolls = 6

export function DeliveryPanel({
  initialStatus,
}: {
  readonly initialStatus?: DeliveryStatus
}) {
  const [status, setStatus] = useState<DeliveryStatus | null>(
    initialStatus ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // After "Write now", keep polling until the queue has written everything.
  const [writing, setWriting] = useState(false)
  const automaticId = useId()
  const progress = useRef({ toWrite: Number.POSITIVE_INFINITY, stalled: 0 })

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const next = await api.music.delivery.status()
        if (!active) return
        setStatus(next)
        setError(null)
        const stalled =
          next.toWrite < progress.current.toWrite
            ? 0
            : progress.current.stalled + 1
        progress.current = { toWrite: next.toWrite, stalled }
        if (next.toWrite === 0 || stalled >= maxStalledPolls) setWriting(false)
        else if (writing || next.automatic)
          timer = setTimeout(load, pollMilliseconds)
      } catch {
        if (active) setError("Delivery status could not be loaded")
      }
    }
    if (status === null || writing || status.automatic) void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [writing, status?.automatic])

  async function send(call: () => Promise<DeliveryStatus>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      setStatus(await call())
      return true
    } catch (cause) {
      setError(errorMessage(cause, failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function writeNow() {
    if (
      await send(() => api.music.delivery.start(), "Writing could not start")
    ) {
      progress.current = { toWrite: Number.POSITIVE_INFINITY, stalled: 0 }
      setWriting(true)
    }
  }

  return (
    <section aria-label="Delivery">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Delivery</h2>
          </CardTitle>
          <CardDescription>
            Adds tracks to the playlists their decisions name. Tracks are only
            ever added, never removed, and un-liked tracks are skipped.
          </CardDescription>
          {status ? (
            <CardAction>
              <Badge variant="secondary">{status.delivered} written</Badge>
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
            <output className="block">
              {status.toWrite > 0
                ? writing || status.automatic
                  ? `Writing to Spotify: ${status.toWrite} left…`
                  : `${status.toWrite} tracks are decided and ready to write.`
                : status.delivered > 0
                  ? `Everything decided is in your playlists${since(status.lastDeliveredAt)}.`
                  : "Nothing to write yet."}
            </output>
          ) : null}
          {status && status.refused > 0 ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-amber-800 dark:text-amber-300">
              <TriangleAlertIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Spotify refused {status.refused} writes, for example to a
                playlist you can no longer edit. Fix the playlist, then press
                Write now to try again.
              </span>
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {status ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button
                disabled={
                  busy ||
                  writing ||
                  (status.toWrite === 0 && status.refused === 0)
                }
                onClick={() => void writeNow()}
                type="button"
              >
                Write now
              </Button>
              <label
                className="flex items-center gap-2 text-sm has-disabled:opacity-50"
                htmlFor={automaticId}
              >
                <input
                  checked={status.automatic}
                  className="size-4 accent-primary"
                  disabled={busy}
                  id={automaticId}
                  onChange={(event) =>
                    void send(
                      () =>
                        api.music.delivery.setAutomatic({
                          automatic: event.target.checked,
                        }),
                      "The setting could not be saved"
                    )
                  }
                  type="checkbox"
                />
                Write automatically after each classification
              </label>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function since(timestamp: number | null) {
  if (timestamp === null) return ""
  return ` (last write ${new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })})`
}
