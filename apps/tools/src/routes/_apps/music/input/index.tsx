import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_apps/music/input/")({
  beforeLoad: () => {
    throw redirect({ href: "/music/input/liked", replace: true })
  },
})
