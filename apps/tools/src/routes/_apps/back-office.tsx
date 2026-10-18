import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { UsersPanel } from "@/features/back-office/users-panel"
import { RequireApp } from "@/features/apps/require-app"

const appsLayout = getRouteApi("/_apps")

/** UsersPanel starts with the page header, which holds its invite button. Rendered only for signed-in users with back office access: the apps layout signs them in. */
export const Route = createFileRoute("/_apps/back-office")({
  head: () => ({
    meta: [{ title: "Back office · Matthieu d'Oultremont" }],
  }),
  component: BackOfficePage,
})

function BackOfficePage() {
  const user = appsLayout.useLoaderData()
  return (
    <RequireApp app="backOffice">
      {user ? <UsersPanel currentUserId={user.id} /> : null}
    </RequireApp>
  )
}
