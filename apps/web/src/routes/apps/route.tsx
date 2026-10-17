import { createFileRoute, Outlet } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { currentUser } from "@/server/entrypoints/http/auth.server"
import { AppShell, SignIn } from "@/features/apps/shell"

const loadCurrentUser = createServerFn({ method: "GET" }).handler(() =>
  currentUser(getRequest())
)

/** Every private app lives under /apps; this layout signs the user in once for all of them. */
export const Route = createFileRoute("/apps")({
  loader: () => loadCurrentUser(),
  head: () => ({
    meta: [
      { title: "Apps · Matthieu d'Oultremont" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AppsLayout,
})

function AppsLayout() {
  const user = Route.useLoaderData()
  if (!user) return <SignIn />
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  )
}
