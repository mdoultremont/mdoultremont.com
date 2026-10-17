import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { UsersPanel } from "@/features/back-office/users-panel"
import { RequireApp } from "@/features/apps/require-app"

const appsLayout = getRouteApi("/apps")

/** Rendered only for signed-in users with back office access: the /apps layout signs them in. */
export const Route = createFileRoute("/apps/back-office")({
  head: () => ({
    meta: [{ title: "Back office · Matthieu d'Oultremont" }],
  }),
  component: BackOfficePage,
})

function BackOfficePage() {
  const user = appsLayout.useLoaderData()
  return (
    <RequireApp app="backOffice">
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">
        Back office
      </h1>
      {user ? <UsersPanel currentUserId={user.id} /> : null}
    </RequireApp>
  )
}
