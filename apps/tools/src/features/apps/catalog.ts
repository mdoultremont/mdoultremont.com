import {
  BackpackIcon,
  BookOpenIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  Music2Icon,
  ShieldIcon,
  SlidersHorizontalIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react"
import type { App } from "@mdoultremont/tools-contracts/auth"
import { ParagliderIcon } from "@/features/flights/icon"

/** The public portfolio, which lives on its own domain. */
export const portfolioUrl = "https://mdoultremont.com"

/**
 * How each private app appears in the browser, in display order. `pages` are
 * the app's sidebar links; the first one is the app's home at `to`.
 */
export const appCatalog = [
  {
    id: "music",
    to: "/music",
    name: "Music",
    description: "Sort Spotify Liked Songs into playlists.",
    icon: Music2Icon,
    pages: [{ to: "/music", label: "Control", icon: SlidersHorizontalIcon }],
  },
  {
    id: "flights",
    to: "/flights",
    name: "Flights",
    description: "Paragliding flight logbook.",
    icon: ParagliderIcon,
    pages: [
      { to: "/flights", label: "Dashboard", icon: LayoutDashboardIcon },
      { to: "/flights/logbook", label: "Logbook", icon: BookOpenIcon },
      { to: "/flights/import", label: "Import", icon: UploadIcon },
      { to: "/flights/equipment", label: "Equipment", icon: BackpackIcon },
    ],
  },
  {
    id: "backOffice",
    to: "/back-office",
    name: "Back office",
    description: "Invite users and choose the apps they may use.",
    icon: ShieldIcon,
    pages: [{ to: "/back-office", label: "Users", icon: UsersIcon }],
  },
] as const satisfies ReadonlyArray<{
  readonly id: App
  readonly to: string
  readonly name: string
  readonly description: string
  readonly icon: LucideIcon
  readonly pages: ReadonlyArray<{
    readonly to: string
    readonly label: string
    readonly icon: LucideIcon
  }>
}>

export type CatalogApp = (typeof appCatalog)[number]
export type AppPage = CatalogApp["pages"][number]

export const appName = (app: App) =>
  appCatalog.find((entry) => entry.id === app)?.name ?? app

/** The app a path belongs to, if any. */
export const appAt = (pathname: string): CatalogApp | undefined =>
  appCatalog.find(
    (app) => pathname === app.to || pathname.startsWith(`${app.to}/`)
  )

/** The sidebar page a path shows: an exact match, else the deepest page it sits under, never the app home. */
export const pageAt = (
  app: CatalogApp,
  pathname: string
): AppPage | undefined => {
  const path = pathname.replace(/\/$/, "")
  const pages: ReadonlyArray<AppPage> = app.pages
  return (
    pages.find((page) => page.to === path) ??
    pages
      .filter((page) => page.to !== app.to && path.startsWith(`${page.to}/`))
      .reduce<AppPage | undefined>(
        (deepest, page) =>
          deepest && deepest.to.length >= page.to.length ? deepest : page,
        undefined
      )
  )
}
