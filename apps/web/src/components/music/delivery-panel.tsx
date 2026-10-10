import { useEffect, useId, useRef, useState } from "react"
import type { DeliveryStatus } from "@/backend/features/music/delivery"

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
        const response = await fetch("/api/music/delivery")
        if (!response.ok) throw new Error("Delivery status could not be loaded")
        const next = (await response.json()) as DeliveryStatus
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
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Delivery status could not be loaded"
          )
      }
    }
    if (status === null || writing || status.automatic) void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [writing, status?.automatic])

  async function send(init: RequestInit, failure: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/music/delivery", {
        ...init,
        headers: {
          "Content-Type": "application/json",
        },
      })
      const payload = (await response.json().catch(() => null)) as
        | (DeliveryStatus & { error?: string })
        | null
      if (!response.ok || !payload) throw new Error(payload?.error ?? failure)
      setStatus(payload)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function writeNow() {
    if (await send({ method: "POST" }, "Writing could not start")) {
      progress.current = { toWrite: Number.POSITIVE_INFINITY, stalled: 0 }
      setWriting(true)
    }
  }

  return (
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Delivery"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">Delivery</h2>
        {status ? (
          <p className="text-sm text-ink/70">{status.delivered} written</p>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink/60">
        Adds tracks to the playlists their decisions name. Tracks are only ever
        added, never removed, and un-liked tracks are skipped.
      </p>

      {status === null && !error ? (
        <p className="mt-3 text-sm text-ink/70">Loading…</p>
      ) : null}
      {status ? (
        <output className="mt-3 block text-sm text-ink/80">
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
        <p className="mt-2 text-sm text-amber-800">
          Spotify refused {status.refused} writes, for example to a playlist you
          can no longer edit. Fix the playlist, then press Write now to try
          again.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {status ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button
            className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
            disabled={
              busy || writing || (status.toWrite === 0 && status.refused === 0)
            }
            onClick={() => void writeNow()}
            type="button"
          >
            Write now
          </button>
          <label
            className="flex items-center gap-2 text-sm text-ink"
            htmlFor={automaticId}
          >
            <input
              checked={status.automatic}
              disabled={busy}
              id={automaticId}
              onChange={(event) =>
                void send(
                  {
                    method: "PUT",
                    body: JSON.stringify({ automatic: event.target.checked }),
                  },
                  "The setting could not be saved"
                )
              }
              type="checkbox"
            />
            Write automatically after each classification
          </label>
        </div>
      ) : null}
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
