import type { App } from "@/backend/features/auth"

/** How each private app appears in the browser, in display order. */
export const appCatalog = [
  {
    id: "music",
    to: "/apps/music",
    name: "Music",
    description: "Sort Spotify Liked Songs into playlists.",
  },
  {
    id: "backOffice",
    to: "/apps/back-office",
    name: "Back office",
    description: "Invite users and choose the apps they may use.",
  },
] as const satisfies ReadonlyArray<{
  readonly id: App
  readonly to: string
  readonly name: string
  readonly description: string
}>

export const appName = (app: App) =>
  appCatalog.find((entry) => entry.id === app)?.name ?? app
