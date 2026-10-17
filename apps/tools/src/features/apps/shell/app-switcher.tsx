import { Link } from "@tanstack/react-router"
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon } from "lucide-react"
import type { CatalogApp } from "@/features/apps/catalog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/features/ui/sidebar"

/** Sidebar header: shows the current app and switches to any other app the user may use. */
export function AppSwitcher({
  apps,
  current,
}: {
  apps: ReadonlyArray<CatalogApp>
  current: CatalogApp | undefined
}) {
  const { isMobile } = useSidebar()
  const Icon = current?.icon ?? LayoutGridIcon
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Icon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-heading font-medium">
                {current?.name ?? "All apps"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                Private apps
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Apps
              </DropdownMenuLabel>
              {apps.map((app) => (
                <DropdownMenuItem
                  key={app.id}
                  className="gap-2 p-2"
                  render={<Link to={app.to} />}
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <app.icon className="size-3.5" />
                  </div>
                  {app.name}
                  {app.id === current?.id ? (
                    <CheckIcon className="ml-auto" aria-label="Current app" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" render={<Link to="/" />}>
              <div className="flex size-6 items-center justify-center rounded-md border">
                <LayoutGridIcon className="size-3.5" />
              </div>
              All apps
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
