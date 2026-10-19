import { createFileRoute, Outlet } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { currentUser } from "@mdoultremont/tools-backend/http"
import { AppShell, SignIn } from "@/features/apps/shell"

const loadCurrentUser = createServerFn({ method: "GET" }).handler(() =>
  currentUser(getRequest())
)

/** Every private app renders in this pathless layout; it signs the user in once for all of them. */
export const Route = createFileRoute("/_apps")({
  loader: () => loadCurrentUser(),
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
