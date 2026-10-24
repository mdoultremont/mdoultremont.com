import { Link } from "@tanstack/react-router"
import { type CatalogApp, pageAt } from "@/features/apps/catalog"
import type { SignedInUser } from "@mdoultremont/tools-contracts/auth"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/features/ui/sidebar"
import { AppSwitcher } from "./app-switcher"
import { NavUser } from "./nav-user"

/** The apps sidebar: app switcher, the current app's pages, and the account menu. */
export function AppSidebar({
  user,
  apps,
  current,
  pathname,
}: {
  user: SignedInUser
  apps: ReadonlyArray<CatalogApp>
  current: CatalogApp | undefined
  pathname: string
}) {
  const { setOpenMobile } = useSidebar()
  const active = current ? pageAt(current, pathname) : undefined
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <AppSwitcher apps={apps} current={current} />
      </SidebarHeader>
      <SidebarContent>
        {current ? (
          <SidebarGroup>
            <SidebarGroupLabel>{current.name}</SidebarGroupLabel>
            <SidebarMenu>
              {current.pages.map((page) => (
                <SidebarMenuItem key={page.to}>
                  <SidebarMenuButton
                    isActive={page === active}
                    aria-current={page === active ? "page" : undefined}
                    onClick={() => setOpenMobile(false)}
                    tooltip={page.label}
                    render={<Link to={page.to} />}
                  >
                    <page.icon />
                    <span>{page.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>Apps</SidebarGroupLabel>
            <SidebarMenu>
              {apps.map((app) => (
                <SidebarMenuItem key={app.id}>
                  <SidebarMenuButton
                    tooltip={app.name}
                    render={<Link to={app.to} />}
                  >
                    <app.icon />
                    <span>{app.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
