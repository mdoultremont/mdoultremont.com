import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { RequireApp } from "@/features/apps/require-app"
import { buttonVariants } from "@/features/ui/button"

export const Route = createFileRoute("/apps/flights")({
  head: () => ({ meta: [{ title: "Flights · Matthieu d'Oultremont" }] }),
  component: FlightsLayout,
})

function FlightsLayout() {
  return (
    <RequireApp app="flights">
      <p className="mt-3 text-lg font-semibold text-foreground">Flights</p>
      <nav
        aria-label="Flights"
        className="mt-5 mb-8 flex flex-wrap gap-1 border-b border-border pb-4"
      >
        {(
          [
            ["/apps/flights", "Dashboard"],
            ["/apps/flights/logbook", "Logbook"],
            ["/apps/flights/import", "Import"],
            ["/apps/flights/equipment", "Equipment"],
          ] as const
        ).map(([to, label]) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className={buttonVariants({
              variant: "ghost",
              className: "text-muted-foreground",
            })}
            activeProps={{
              className: "bg-secondary font-medium text-foreground",
              "aria-current": "page",
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </RequireApp>
  )
}
