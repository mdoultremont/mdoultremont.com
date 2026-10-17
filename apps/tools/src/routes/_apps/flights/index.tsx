import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
  getFlightStats,
  type Dashboard as DashboardData,
} from "@/features/flights/api"
import { PageHeader } from "@/features/apps/shell"
import { Dashboard } from "@/features/flights/dashboard/dashboard"
import { ErrorState } from "@/features/flights/layout/ui"
import { Skeleton } from "@/features/ui/skeleton"

export const Route = createFileRoute("/_apps/flights/")({
  component: FlightsDashboardPage,
})

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: DashboardData; now: number }

function FlightsDashboardPage() {
  const [view, setView] = useState<View>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    getFlightStats()
      .then((data) => {
        if (active) setView({ kind: "ready", data, now: Date.now() })
      })
      .catch((cause: unknown) => {
        if (active)
          setView({
            kind: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Flight statistics could not be loaded",
          })
      })
    return () => {
      active = false
    }
  }, [attempt])

  if (view.kind === "ready")
    return <Dashboard data={view.data} now={view.now} />
  return (
    <section>
      <PageHeader
        title="Flight dashboard"
        description="Your time in the air, at a glance."
      />
      {view.kind === "loading" ? (
        <div className="space-y-6">
          <output className="block text-sm text-muted-foreground">
            Loading your logbook…
          </output>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <ErrorState
          error={view.message}
          reload={() => {
            setView({ kind: "loading" })
            setAttempt((value) => value + 1)
          }}
        />
      )}
    </section>
  )
}
