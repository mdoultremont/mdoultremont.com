import { createFileRoute } from "@tanstack/react-router"
import { FlightEquipment } from "@/features/flights/equipment/flight-equipment"
export const Route = createFileRoute("/_apps/flights/equipment")({
  component: FlightEquipment,
})
