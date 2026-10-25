import { createFileRoute, Outlet } from "@tanstack/react-router"
import { RequireApp } from "@/features/apps/require-app"
import { MusicLayout as MusicFrame } from "@/features/music/music-layout"

export const Route = createFileRoute("/_apps/music")({
  head: () => ({ meta: [{ title: "Music · Matthieu d'Oultremont" }] }),
  component: MusicLayout,
})

function MusicLayout() {
  return (
    <RequireApp app="music">
      <MusicFrame>
        <Outlet />
      </MusicFrame>
    </RequireApp>
  )
}
