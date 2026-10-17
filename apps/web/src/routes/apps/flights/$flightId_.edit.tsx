import { createFileRoute } from "@tanstack/react-router"
import { FlightEdit } from "@/features/flights/edit/flight-edit"
export const Route = createFileRoute("/apps/flights/$flightId_/edit")({
  component: FlightEditPage,
})
function FlightEditPage() {
  const { flightId } = Route.useParams()
  return <FlightEdit key={flightId} flightId={flightId} />
}
