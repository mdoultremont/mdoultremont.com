import { createFileRoute } from "@tanstack/react-router"
import { FlightLogbook } from "@/features/flights/logbook/flight-logbook"
export const Route = createFileRoute("/apps/flights/logbook")({
  component: FlightLogbook,
})
