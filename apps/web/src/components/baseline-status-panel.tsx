import { useEffect, useState } from "react"

type BaselineStatus =
  | { readonly status: "disconnected" | "not_started" }
  | {
      readonly status: "queued" | "running" | "completed" | "failed"
      readonly runId: string
      readonly pages: number
      readonly scanned: number
      readonly recorded: number
      readonly recent: number
      readonly total: number | null
      readonly error: string | null
      readonly updatedAt: number
    }

export function BaselineStatusPanel({
  csrfToken,
}: {
  readonly csrfToken: string
}) {
  const [status, setStatus] = useState<BaselineStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(0)
  const queueFailed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("spotify") ===
      "baseline_failed"

  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const response = await fetch("/api/music/baseline")
        if (!response.ok)
          throw new Error("Initialization status could not be loaded")
        const value = (await response.json()) as BaselineStatus
        if (active) {
          setStatus(value)
          setError(null)
          setNow(Date.now())
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Initialization status could not be loaded"
          )
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  async function submit(action: "start" | "retry") {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        action === "start"
          ? "/api/music/baseline"
          : "/api/music/baseline/retry",
        {
          method: "POST",
          headers: {
            "X-CSRF-Token": csrfToken,
          },
        }
      )
      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        throw new Error(body.error ?? "Initialization could not be started")
      }
      setStatus((await response.json()) as BaselineStatus)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Initialization could not be started"
      )
    } finally {
      setBusy(false)
    }
  }

  if (status?.status === "disconnected") return null
  const active = status && "runId" in status ? status : null
  const stale =
    active &&
    (active.status === "queued" || active.status === "running") &&
    now - active.updatedAt > 120_000

  return (
    <section
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      aria-label="Liked Songs initialization"
    >
      <h2 className="text-lg font-semibold text-ink">
        Liked Songs initialization
      </h2>
      {!status && !error ? (
        <p className="mt-2 text-sm text-ink/70">Checking initialization…</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {queueFailed ? (
        <p className="mt-2 text-sm text-red-800" role="alert">
          Spotify connected, but initialization could not be queued. Use the
          action below to retry.
        </p>
      ) : null}
      {status?.status === "not_started" ? (
        <div className="mt-2">
          <p className="text-sm text-ink/70">
            Record your existing likes in the background before processing new
            ones.
          </p>
          <button
            className="mt-3 rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={busy}
            onClick={() => {
              void submit("start")
            }}
          >
            Start initialization
          </button>
        </div>
      ) : null}
      {active ? (
        <div className="mt-2 text-sm text-ink/70" aria-live="polite">
          <p>
            {active.status === "completed"
              ? "Initialization complete."
              : active.status === "failed"
                ? "Initialization stopped."
                : active.status === "queued"
                  ? "Initialization queued."
                  : "Initialization running in the background."}
          </p>
          <p className="mt-1">
            {active.recorded} existing likes recorded across {active.pages}{" "}
            pages. {active.recent} likes at or after the cutoff remain eligible
            for later processing.
          </p>
          <p className="mt-1 text-xs">Run ID: {active.runId}</p>
          {active.status === "failed" ? (
            <p className="mt-2 text-red-800" role="alert">
              {active.error ?? "Initialization stopped unexpectedly."} Reconnect
              Spotify if needed, then retry.
            </p>
          ) : null}
          {active.status === "failed" || stale ? (
            <button
              className="mt-3 rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
              type="button"
              disabled={busy}
              onClick={() => {
                void submit("retry")
              }}
            >
              Retry from saved progress
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
