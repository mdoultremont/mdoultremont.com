import { Link, useLocation } from "@tanstack/react-router"
import { Fragment, type ReactNode } from "react"
import { appAt, appCatalog, pageAt } from "@/features/apps/catalog"
import type { SignedInUser } from "@mdoultremont/tools-contracts/auth"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/features/ui/breadcrumb"
import { Separator } from "@/features/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/features/ui/sidebar"
import { TooltipProvider } from "@/features/ui/tooltip"
import { AppSidebar } from "./app-sidebar"
import { AuthError } from "./auth-error"
import { SidebarSlotsProvider } from "./sidebar-slots"

/** The signed-in apps frame (shadcn sidebar-08). */
export function AppShell({
  user,
  children,
}: {
  user: SignedInUser
  children: ReactNode
}) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const apps = appCatalog.filter((app) => user.apps.includes(app.id))
  const current = appAt(pathname)
  const page = current ? pageAt(current, pathname) : undefined
  const crumbs: ReadonlyArray<{ label: string; to?: string }> = current
    ? [
        { label: current.name, to: current.to },
        ...(page && page.to !== current.to
          ? [{ label: page.label, to: page.to }]
          : []),
      ]
    : [{ label: "All apps" }]

  return (
    <TooltipProvider>
      <SidebarSlotsProvider>
        <SidebarProvider className="md:h-svh md:overflow-hidden">
          <AppSidebar
            user={user}
            apps={apps}
            current={current}
            pathname={pathname}
          />
          <SidebarInset className="md:min-h-0 md:overflow-hidden">
            <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 bg-background md:static md:rounded-t-xl">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-vertical:h-4 data-vertical:self-auto"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    {crumbs.map((crumb, index) => {
                      const last = index === crumbs.length - 1
                      return (
                        <Fragment key={crumb.label}>
                          {index > 0 ? <BreadcrumbSeparator /> : null}
                          <BreadcrumbItem>
                            {last &&
                            pathname.replace(/\/$/, "") === crumb.to ? (
                              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                            ) : crumb.to ? (
                              <BreadcrumbLink render={<Link to={crumb.to} />}>
                                {crumb.label}
                              </BreadcrumbLink>
                            ) : (
                              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                            )}
                          </BreadcrumbItem>
                        </Fragment>
                      )
                    })}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div
              data-slot="app-scroll-area"
              className="flex min-h-0 flex-1 flex-col md:overflow-y-auto"
            >
              <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-12 md:px-8">
                <AuthError className="mb-6" />
                {children}
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </SidebarSlotsProvider>
    </TooltipProvider>
  )
}
