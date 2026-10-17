import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { type CatalogApp, pageAt, portfolioUrl } from "@/features/apps/catalog"
import type { SignedInUser } from "@/server/actions/auth"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  // oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- the button renders its children into the link
                  render={<a href={portfolioUrl} />}
                >
                  <ArrowLeftIcon />
                  <span>Portfolio</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
