import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { UsersPanel } from "@/features/back-office/users-panel"
import { RequireApp } from "@/features/apps/require-app"
import { PageHeader } from "@/features/apps/shell"

const appsLayout = getRouteApi("/_apps")

/** Rendered only for signed-in users with back office access: the apps layout signs them in. */
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
      <PageHeader
        description="Invite people and choose the apps they may use."
        title="Users"
      />
      {user ? <UsersPanel currentUserId={user.id} /> : null}
    </RequireApp>
  )
}
