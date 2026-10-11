import { getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { App } from "@/backend/features/auth"

const appsLayout = getRouteApi("/apps")

/** Renders the app only for users with access to it. Its API checks access again. */
export function RequireApp({
  app,
  children,
}: {
  app: App
  children: ReactNode
}) {
  const user = appsLayout.useLoaderData()
  if (user?.apps.includes(app)) return children
  return (
    <p className="mt-3 text-base leading-7 text-ink/70">
      You do not have access to this app.
    </p>
  )
}
