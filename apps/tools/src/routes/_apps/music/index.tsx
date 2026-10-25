import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_apps/music/")({
  beforeLoad: ({ location }) => {
    if (new URLSearchParams(location.searchStr).has("spotify")) {
      throw redirect({
        href: `/music/settings${location.searchStr}`,
        replace: true,
      })
    }
    throw redirect({
      href: `/music/input/liked${location.searchStr}`,
      replace: true,
    })
  },
})
