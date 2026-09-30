import { z } from "zod"
import flightsData from "../../content/flights.json"
import lifeEventsData from "../../content/life-events.json"
import personalData from "../../content/personal.json"
import placesData from "../../content/places.json"

const flightSchema = z.object({
  name: z.string().min(1),
  flownAt: z.iso.date(),
  launchName: z.string().min(1),
  distanceMeters: z.number().positive(),
  durationSeconds: z.number().positive(),
  maxAltitudeMeters: z.number().positive(),
  maxSpeedKph: z.number().positive(),
  trace: z
    .union([z.string().min(1), z.literal("")])
    .transform((value) => value || undefined),
})

const placeSchema = z.object({
  name: z.string().min(1),
  country: z.string().min(1),
  visitedAt: z.iso.date(),
  description: z.string().min(1),
})

const lifeEventSchema = z.object({
  title: z.string().min(1),
  eventAt: z.iso.date(),
  location: z.string().min(1),
  description: z.string().min(1),
})

const personalContentSchema = z.object({
  page: z.object({
    hero: z.object({
      eyebrow: z.string().min(1),
      title: z.string().min(1),
      introduction: z.string().min(1),
    }),
    timeline: z.object({
      eyebrow: z.string().min(1),
      title: z.string().min(1),
      introduction: z.string().min(1),
    }),
    family: z.object({
      title: z.string().min(1),
      introduction: z.string().min(1),
    }),
    flightTitle: z.string().min(1),
    cookingTitle: z.string().min(1),
  }),
  flights: z.array(flightSchema),
  places: z.array(placeSchema),
  lifeEvents: z.array(lifeEventSchema),
})

export type Flight = z.infer<typeof flightSchema>
export type Place = z.infer<typeof placeSchema>
export type LifeEvent = z.infer<typeof lifeEventSchema>

export function createPersonalContent(source: unknown) {
  const content = personalContentSchema.parse(source)
  return {
    copy: content.page,
    flights: content.flights,
    places: content.places,
    lifeEvents: content.lifeEvents,
  }
}

export const {
  copy: personalCopy,
  flights,
  places,
  lifeEvents,
} = createPersonalContent({
  page: personalData,
  flights: flightsData,
  places: placesData,
  lifeEvents: lifeEventsData,
})
