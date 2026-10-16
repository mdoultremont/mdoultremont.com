import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
  getFlightStats,
  type Dashboard as DashboardData,
} from "@/features/flights/api"
import { Dashboard } from "@/features/flights/dashboard/dashboard"
import { Button } from "@/features/ui/button"
import { Card } from "@/features/ui/card"
import { Skeleton } from "@/features/ui/skeleton"

export const Route = createFileRoute("/apps/flights/")({
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
    <section className="dark-surface text-foreground dark:-mx-3 dark:rounded-2xl dark:p-3">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Flight dashboard
      </h1>
      {view.kind === "loading" ? (
        <>
          <output className="mt-4 block text-sm text-muted-foreground">
            Loading your logbook…
          </output>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-24 rounded-xl" />
            ))}
          </div>
        </>
      ) : (
        <Card className="mt-6 px-5">
          <p role="alert" className="text-sm">
            {view.message}
          </p>
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => {
              setView({ kind: "loading" })
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </Button>
        </Card>
      )}
    </section>
  )
}
