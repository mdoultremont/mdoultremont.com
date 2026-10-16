import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { appCatalog } from "@/features/apps/catalog"

export const Route = createFileRoute("/apps/")({
  component: AppsIndex,
})

const appsLayout = getRouteApi("/apps")

function AppsIndex() {
  const user = appsLayout.useLoaderData()
  const apps = appCatalog.filter((app) => user?.apps.includes(app.id))
  return (
    <>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">
        Apps
      </h1>
      {apps.length === 0 ? (
        <p className="mt-8 text-base leading-7 text-ink/70">
          You do not have access to any app yet.
        </p>
      ) : (
        <ul className="mt-8 grid gap-3">
          {apps.map((app) => (
            <li key={app.to}>
              <Link
                className="block rounded-2xl border border-ink/10 p-5 transition hover:bg-ink/5"
                to={app.to}
              >
                <span className="font-semibold text-ink">{app.name}</span>
                <span className="mt-1 block text-sm text-ink/70">
                  {app.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
