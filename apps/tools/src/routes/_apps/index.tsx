import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { ChevronRightIcon, LayoutGridIcon } from "lucide-react"
import { appCatalog } from "@/features/apps/catalog"
import { PageHeader } from "@/features/apps/shell"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/features/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/features/ui/item"

export const Route = createFileRoute("/_apps/")({
  component: AppsIndex,
})

const appsLayout = getRouteApi("/_apps")

function AppsIndex() {
  const user = appsLayout.useLoaderData()
  const apps = appCatalog.filter((app) => user?.apps.includes(app.id))
  return (
    <>
      <PageHeader title="Apps" description="Everything you have access to." />
      {apps.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGridIcon />
            </EmptyMedia>
            <EmptyTitle>No apps yet</EmptyTitle>
            <EmptyDescription>
              You do not have access to any app yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-3">
          {apps.map((app) => (
            <Item key={app.id} variant="outline" render={<Link to={app.to} />}>
              <ItemMedia variant="icon">
                <app.icon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="font-heading">{app.name}</ItemTitle>
                <ItemDescription>{app.description}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </>
  )
}
