import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { getFlight, type FlightDetail } from "@/features/flights/api"
import { PageHeader } from "@/features/apps/shell"
import { ErrorState } from "@/features/flights/layout/ui"
import { FlightViewer } from "@/features/flights/viewer"
import { Skeleton } from "@/features/ui/skeleton"

export const Route = createFileRoute("/_apps/flights/$flightId")({
  component: FlightDetailPage,
})

function FlightDetailPage() {
  const { flightId } = Route.useParams()
  const [detail, setDetail] = useState<FlightDetail | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setDetail(null)
    setError("")
    void getFlight(flightId).then(
      (value) => {
        if (active) setDetail(value)
      },
      (cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Flight could not be loaded"
          )
      }
    )
    return () => {
      active = false
    }
  }, [flightId, attempt])
  if (error)
    return (
      <section>
        <PageHeader title="Flight unavailable" />
        <ErrorState
          error={error}
          reload={() => setAttempt((value) => value + 1)}
        >
          <Link to="/flights/logbook" className="underline underline-offset-4">
            All flights
          </Link>
        </ErrorState>
      </section>
    )
  if (!detail)
    return (
      <div className="space-y-4">
        <output className="block text-sm text-muted-foreground">
          Loading flight…
        </output>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  return <FlightViewer key={flightId} detail={detail} />
}
