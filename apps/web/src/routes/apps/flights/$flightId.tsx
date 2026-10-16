import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { getFlight, type FlightDetail } from "@/features/flights/api"
import { FlightViewer } from "@/features/flights/viewer"
import { Button } from "@/features/ui/button"
import { Skeleton } from "@/features/ui/skeleton"

export const Route = createFileRoute("/apps/flights/$flightId")({
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
      <div className="mt-6 space-y-4 text-foreground">
        <h1 className="text-3xl font-semibold tracking-tight">
          Flight unavailable
        </h1>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
          <Link
            to="/apps/flights/logbook"
            className="underline underline-offset-4"
          >
            All flights
          </Link>
        </div>
      </div>
    )
  if (!detail)
    return (
      <div className="mt-6 space-y-4">
        <output className="block text-sm text-muted-foreground">
          Loading flight…
        </output>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  return <FlightViewer key={flightId} detail={detail} />
}
