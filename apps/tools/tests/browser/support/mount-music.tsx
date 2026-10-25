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
import { MusicPlayerLayout } from "../../../src/features/music/music-player-layout"
import { OutputPlaylists } from "../../../src/features/music/output-playlists"
import { InputPlaylists } from "../../../src/features/music/input-playlists"

const user = {
  id: "fixture-owner",
  name: "Music owner",
  email: "owner@example.com",
  image: null,
  providers: ["spotify"],
  apps: ["music"] as const,
}
export async function mountMusic(path = "/music/input") {
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
      <MusicPlayerLayout>
        <Outlet />
      </MusicPlayerLayout>
    ),
  })
  const input = createRoute({
    getParentRoute: () => music,
    path: "/input",
    validateSearch: (search: Record<string, unknown>) => ({
      playlist:
        typeof search.playlist === "string" ? search.playlist : undefined,
    }),
    component: Inputs,
  })
  function Inputs() {
    const navigate = input.useNavigate()
    const { playlist } = input.useSearch()
    return (
      <InputPlaylists
        selected={playlist}
        onSelect={(key) => void navigate({ search: { playlist: key } })}
      />
    )
  }
  const output = createRoute({
    getParentRoute: () => music,
    path: "/output",
    validateSearch: (search: Record<string, unknown>) => ({
      playlist:
        typeof search.playlist === "string" ? search.playlist : undefined,
    }),
    component: Outputs,
  })
  function Outputs() {
    const navigate = output.useNavigate()
    const { playlist } = output.useSearch()
    return (
      <OutputPlaylists
        selected={playlist}
        onSelect={(key) => void navigate({ search: { playlist: key } })}
      />
    )
  }
  const settings = createRoute({
    getParentRoute: () => music,
    path: "/settings",
    component: MusicSettings,
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren([
      apps.addChildren([music.addChildren([input, output, settings])]),
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
