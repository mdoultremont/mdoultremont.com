import { Switch } from "@base-ui/react/switch"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { SiteShell } from "../components/site-shell"
import { flights, lifeEvents, personalCopy, places } from "../content/personal"
import type { Flight } from "../content/personal"

export const Route = createFileRoute("/personal")({
  component: PersonalPage,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
})

type PersonalTimelineItem = {
  id: string
  kind: "flight" | "visit" | "life"
  date: string
  title: string
  location: string
  description: string
  flight?: Flight
}

function PersonalPage() {
  const [showFlights, setShowFlights] = useState(false)
  const timeline = createTimeline().filter(
    (item) => showFlights || item.kind !== "flight"
  )

  return (
    <SiteShell>
      <main>
        <section className="border-b border-line">
          <div className="mx-auto grid w-[calc(100%-2rem)] max-w-[1440px] items-end gap-10 border-x border-line px-4 py-16 sm:w-[calc(100%-4rem)] sm:px-6 sm:py-20 lg:w-[calc(100%-6rem)] lg:grid-cols-[1fr_minmax(17rem,0.5fr)] lg:gap-24 lg:px-8 lg:py-24">
            <div>
              <p className="text-[0.7rem] font-bold tracking-[0.12em] text-muted uppercase">
                {personalCopy.hero.eyebrow}
              </p>
              <h1 className="mt-4 max-w-[9ch] text-[clamp(4rem,9vw,9rem)] leading-[0.9] font-medium tracking-[-0.065em]">
                {personalCopy.hero.title}
              </h1>
            </div>
            <p className="text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.55] text-muted">
              {personalCopy.hero.introduction}
            </p>
          </div>
        </section>
        <section className="border-b border-line">
          <div className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] border-x border-line px-4 py-16 sm:w-[calc(100%-4rem)] sm:px-6 sm:py-20 lg:w-[calc(100%-6rem)] lg:px-8 lg:py-24">
            <header className="flex flex-col items-start justify-between gap-8 border-b border-line pb-8 sm:flex-row sm:items-end">
              <div>
                <p className="text-[0.7rem] font-bold tracking-[0.12em] text-muted uppercase">
                  {personalCopy.timeline.eyebrow}
                </p>
                <h2 className="mt-4 text-[clamp(2.5rem,5vw,5.8rem)] leading-[0.9] font-medium tracking-[-0.065em]">
                  {personalCopy.timeline.title}
                </h2>
                <p className="mt-5 max-w-xl text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.55] text-muted">
                  {personalCopy.timeline.introduction}
                </p>
              </div>
              <div className="inline-flex items-center gap-3 text-xs font-semibold text-muted">
                Show flights
                <Switch.Root
                  aria-label="Show flights in the timeline"
                  className="relative h-6 w-10 cursor-pointer rounded-full bg-[#dcdad5] p-1 transition-colors data-[checked]:bg-[#f43f3c]"
                  checked={showFlights}
                  onCheckedChange={setShowFlights}
                >
                  <Switch.Thumb className="block size-4 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-4" />
                </Switch.Root>
              </div>
            </header>
            <div className="border-l border-line">
              {timeline.map((item) => (
                <details
                  className="group border-r border-b border-line"
                  key={item.id}
                >
                  <summary className="grid min-h-24 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-5 px-4 py-5 marker:hidden sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:px-6">
                    <span className="hidden text-xs text-muted sm:block">
                      <time dateTime={item.date || undefined}>
                        {formatDate(item.date)}
                      </time>
                    </span>
                    <span>
                      <strong className="block text-base font-bold">
                        {item.title}
                      </strong>
                      <span className="mt-1 block text-sm text-muted">
                        {timelineLabels[item.kind]}
                        {item.location && ` · ${item.location}`}
                      </span>
                    </span>
                    <span
                      className="text-lg text-accent-dark group-open:rotate-45"
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </summary>
                  <div className="px-4 pb-7 leading-[1.55] text-muted sm:pl-[10.75rem]">
                    <p className="max-w-2xl">{item.description}</p>
                    {item.flight && (
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-3 text-sm text-ink">
                        <span>
                          {formatDistance(item.flight.distanceMeters)}
                        </span>
                        <span>
                          {formatDuration(item.flight.durationSeconds)}
                        </span>
                        <span>
                          {item.flight.maxAltitudeMeters.toLocaleString("en")} m
                        </span>
                        <span>{item.flight.maxSpeedKph} km/h</span>
                      </div>
                    )}
                    {item.kind === "visit" && (
                      <p className="mt-3 text-sm italic">
                        Photos and the full travel entry will live here later.
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  )
}

const timelineLabels = {
  flight: "Flight",
  visit: "Visit",
  life: "Life event",
} as const

function createTimeline(): PersonalTimelineItem[] {
  const items: PersonalTimelineItem[] = [
    ...flights.map((flight) => ({
      id: `flight-${flight.name}-${flight.flownAt}`,
      kind: "flight" as const,
      date: flight.flownAt,
      title: flight.name,
      location: flight.launchName,
      description: `${formatDuration(flight.durationSeconds)} in the air, with a maximum altitude of ${flight.maxAltitudeMeters.toLocaleString("en")} metres.`,
      flight,
    })),
    ...places.map((place) => ({
      id: `visit-${place.name}`,
      kind: "visit" as const,
      date: place.visitedAt,
      title: place.name,
      location: place.country,
      description: place.description,
    })),
    ...lifeEvents.map((event) => ({
      id: `life-${event.title}`,
      kind: "life" as const,
      date: event.eventAt,
      title: event.title,
      location: event.location,
      description: event.description,
    })),
  ]
  // oxlint-disable-next-line unicorn/no-array-sort -- `items` is a new local array.
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

function formatDate(date: string) {
  if (!date) return "Date to add"
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`))
}

function formatDistance(meters: number) {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(meters / 1_000)} km`
}
function formatDuration(seconds: number) {
  return `${Math.round(seconds / 60)} min`
}
