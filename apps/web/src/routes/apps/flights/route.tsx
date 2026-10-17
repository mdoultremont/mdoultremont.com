import { createFileRoute, Outlet } from "@tanstack/react-router"
import { RequireApp } from "@/features/apps/require-app"

export const Route = createFileRoute("/apps/flights")({
  head: () => ({ meta: [{ title: "Flights · Matthieu d'Oultremont" }] }),
  component: FlightsLayout,
})

/** Flights pages are listed in the sidebar from the app catalog. */
function FlightsLayout() {
  return (
    <RequireApp app="flights">
      <Outlet />
    </RequireApp>
  )
}
