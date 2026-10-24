import { createFileRoute, redirect } from "@tanstack/react-router"
import { musicPages } from "@/features/apps/catalog"

export const Route = createFileRoute("/_apps/music/")({
  beforeLoad: ({ location }) => {
    if (new URLSearchParams(location.searchStr).has("spotify")) {
      throw redirect({
        href: `/music/settings${location.searchStr}`,
        replace: true,
      })
    }
    throw redirect({
      href: `${musicPages[0].to}${location.searchStr}`,
      replace: true,
    })
  },
})
