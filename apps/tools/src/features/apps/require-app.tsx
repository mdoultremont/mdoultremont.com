import { getRouteApi } from "@tanstack/react-router"
import { LockIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { App } from "@/server/actions/auth"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/features/ui/empty"

const appsLayout = getRouteApi("/_apps")

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
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>No access</EmptyTitle>
        <EmptyDescription>You do not have access to this app.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
