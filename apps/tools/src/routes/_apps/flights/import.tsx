import { createFileRoute } from "@tanstack/react-router"
import { FlightImport } from "@/features/flights/import/flight-import"
export const Route = createFileRoute("/_apps/flights/import")({
  component: FlightImport,
})
