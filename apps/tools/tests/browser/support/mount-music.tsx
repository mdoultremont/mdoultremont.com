import { createRoot } from "react-dom/client"
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router"
import { AppShell } from "../../../src/features/apps/shell"
import { MusicSettings } from "../../../src/features/music/music-settings"
import { MusicLayout } from "../../../src/features/music/music-layout"
import { OutputPlaylistPage } from "../../../src/features/music/output-playlist-page"
import { SuggestPage } from "../../../src/features/music/suggest-page"
import { InputPlaylistPage } from "../../../src/features/music/input-playlist-page"

const user = {
  id: "fixture-owner",
  name: "Music owner",
  email: "owner@example.com",
  image: null,
  providers: ["spotify"],
  apps: ["music"] as const,
}
export async function mountMusic(path = "/music/input/liked") {
  const root = createRootRoute({ component: Outlet })
  const apps = createRoute({
    getParentRoute: () => root,
    id: "fixture-apps",
    component: () => (
      <AppShell user={user}>
        <Outlet />
      </AppShell>
    ),
  })
  const music = createRoute({
    getParentRoute: () => apps,
    path: "/music",
    component: () => (
      <MusicLayout>
        <Outlet />
      </MusicLayout>
    ),
  })
  const input = createRoute({
    getParentRoute: () => music,
    path: "/input/$playlist",
    component: function Input() {
      const { playlist } = input.useParams()
      return <InputPlaylistPage playlistKey={playlist} />
    },
  })
  const suggest = createRoute({
    getParentRoute: () => music,
    path: "/output/",
    component: SuggestPage,
  })
  const output = createRoute({
    getParentRoute: () => music,
    path: "/output/$playlist",
    component: function Output() {
      const { playlist } = output.useParams()
      return <OutputPlaylistPage playlistId={playlist} />
    },
  })
  const settings = createRoute({
    getParentRoute: () => music,
    path: "/settings",
    component: MusicSettings,
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren([
      apps.addChildren([music.addChildren([input, suggest, output, settings])]),
    ]),
  })
  await router.load()
  const element = document.createElement("div")
  for (const child of document.body.children) {
    if (child instanceof HTMLElement) child.style.display = "none"
  }
  document.body.appendChild(element)
  createRoot(element).render(<RouterProvider router={router} />)
}
