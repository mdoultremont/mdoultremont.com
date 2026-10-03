import { useEffect, useState } from "react"

interface RunStatus {
  automationEnabled: boolean
  evaluation: string
  runs: {
    id: string
    mode: string
    status: string
    phase: string
    scanned: number
    processed: number
    delivered: number
    error: string | null
  }[]
}
export function MusicRunsPanel({ csrfToken }: { csrfToken: string }) {
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const response = await fetch("/api/music/runs")
        if (!response.ok) throw new Error("Run status could not be loaded")
        const value: RunStatus = await response.json()
        if (active) setStatus(value)
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Run status unavailable"
          )
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  async function mutate(method: "PUT" | "POST", body: object) {
    const previousStatus = status
    setBusy(true)
    setError(null)
    if (
      method === "PUT" &&
      "enabled" in body &&
      typeof body.enabled === "boolean"
    ) {
      const enabled = body.enabled
      setStatus((current) =>
        current ? { ...current, automationEnabled: enabled } : current
      )
    }
    try {
      const response = await fetch("/api/music/runs", {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      })
      const value = await response.json()
      if (!response.ok)
        throw new Error(
          typeof value === "object" &&
            value !== null &&
            "error" in value &&
            typeof value.error === "string"
            ? value.error
            : "Run request failed"
        )
      const refreshed = await fetch("/api/music/runs")
      if (!refreshed.ok) throw new Error("Run status could not be loaded")
      setStatus(await refreshed.json())
    } catch (cause) {
      setStatus(previousStatus)
      setError(cause instanceof Error ? cause.message : "Run request failed")
    } finally {
      setBusy(false)
    }
  }
  const running = status?.runs.some(
    (run) => run.status === "queued" || run.status === "running"
  )
  return (
    <section
      className="mt-8 border-t border-ink/10 pt-8"
      aria-labelledby="music-runs-heading"
    >
      <h2 id="music-runs-heading" className="text-xl font-semibold">
        Music runs
      </h2>
      <p className="mt-3 text-sm leading-6">
        Dry-run mode: runs discover eligible likes without changing playlists.
        Jev calls and all playlist additions are disabled until an owner-labeled
        evaluation establishes a useful threshold.
      </p>
      <label className="mt-4 flex items-center gap-3">
        <input
          type="checkbox"
          checked={status?.automationEnabled ?? false}
          disabled={!status || busy}
          onChange={(event) =>
            void mutate("PUT", { enabled: event.target.checked })
          }
        />
        Hourly catch-up
      </label>
      <p className="mt-2 text-sm">
        Pausing stops new scheduled runs. Current runs finish; manual runs
        remain available.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {(
          [
            ["catchup", "Catch up new likes"],
            ["full", "Full run · restore missing entries"],
            ["reclassify", "Full reclassification"],
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
            key={mode}
            disabled={busy || running || !status}
            onClick={() => void mutate("POST", { mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm">
        Full runs scan all current likes and can refill playlists after manual
        removals. While the evaluation gate is closed, both full actions only
        scan and report progress.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <div aria-live="polite" className="mt-5 space-y-4">
        {status?.runs.map((run) => (
          <article key={run.id} className="rounded-xl bg-ink/5 p-4 text-sm">
            <p className="font-medium">
              {run.mode} · {run.status} · {run.phase}
            </p>
            <p className="mt-1 break-all">Run {run.id}</p>
            <p className="mt-2">
              {run.scanned} discovered · {run.processed} processed ·{" "}
              {run.delivered} additions
            </p>
            {run.error ? (
              <p className="mt-2 text-red-800">{run.error}</p>
            ) : null}
          </article>
        ))}
        {status && !status.runs.length ? (
          <p className="text-sm">No runs yet.</p>
        ) : null}
      </div>
    </section>
  )
}
