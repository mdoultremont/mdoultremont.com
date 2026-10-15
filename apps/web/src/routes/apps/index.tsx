import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/apps/")({
  component: AppsIndex,
})

function AppsIndex() {
  return (
    <>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">
        Apps
      </h1>
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
    </>
  )
}

const apps = [
  {
    to: "/apps/music",
    name: "Music",
    description: "Sort Spotify Liked Songs into playlists.",
  },
] as const
