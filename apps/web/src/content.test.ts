import { describe, expect, test } from "vitest"
import { createPersonalContent } from "./content/personal"
import { createPhotographyContent } from "./content/photography"
import { createProfessionalContent } from "./content/professional"

const professionalPage = {
  hero: { eyebrow: "Work", introduction: "A short introduction." },
  statement: "A professional statement.",
  experience: {
    eyebrow: "Experience",
    title: "Selected work",
    introduction: "A short experience introduction.",
  },
  contact: { eyebrow: "Contact", title: "Get in touch" },
}

const experiences = [
  {
    company: "First company",
    role: "Engineer",
    startDate: "2024-08-01",
    endDate: "",
    summary: "Built useful things.",
  },
  {
    company: "Second company",
    role: "Designer",
    startDate: "2023-10-01",
    endDate: "2024-08-01",
    summary: "Designed useful things.",
  },
]

const photographyPage = {
  hero: {
    eyebrow: "Photography",
    title: "Through my lens",
    introduction: "A short photography introduction.",
  },
}

const personalPage = {
  hero: {
    eyebrow: "Personal",
    title: "Life outside work",
    introduction: "A short personal introduction.",
  },
  timeline: {
    eyebrow: "Timeline",
    title: "A life in progress",
    introduction: "A short timeline introduction.",
  },
  family: { title: "Family", introduction: "A short family introduction." },
  flightTitle: "Flights",
  cookingTitle: "Cooking",
}

const flights = [
  {
    name: "Test flight",
    flownAt: "2024-05-01",
    launchName: "Test launch",
    distanceMeters: 1000,
    durationSeconds: 120,
    maxAltitudeMeters: 100,
    maxSpeedKph: 50,
    trace: "",
  },
]

describe("portfolio content", () => {
  test("keeps collection items in their JSON array order", () => {
    const source = structuredClone({ page: professionalPage, experiences })
    source.experiences.reverse()

    const content = createProfessionalContent(source)

    expect(content.experiences.map(({ company }) => company)).toEqual(
      source.experiences.map(({ company }) => company)
    )
  })

  test("derives display periods for professional experiences", () => {
    const content = createProfessionalContent({
      page: professionalPage,
      experiences,
    })

    expect(content.experiences.slice(0, 2)).toMatchObject([
      { company: "First company", period: "Aug 2024 – Present" },
      { company: "Second company", period: "Oct 2023 – Aug 2024" },
    ])
  })

  test("rejects an experience without a summary", () => {
    const source = structuredClone({ page: professionalPage, experiences })
    source.experiences[0].summary = ""

    expect(() => createProfessionalContent(source)).toThrow("summary")
  })

  test("allows photograph metadata to be filled progressively", () => {
    const source = {
      page: photographyPage,
      photographs: [
        { src: "/media/photography/one.jpg", year: 2024 },
        { src: "/media/photography/two.jpg" },
      ],
    }

    expect(createPhotographyContent(source).photographs).toEqual(
      source.photographs
    )
  })

  test.each([21, 2021.5, 10000])(
    "rejects invalid photograph year %s",
    (year) => {
      expect(() =>
        createPhotographyContent({
          page: photographyPage,
          photographs: [{ src: "/photo.jpg", year }],
        })
      ).toThrow("year")
    }
  )

  test("loads personal content independently", () => {
    const content = createPersonalContent({
      page: personalPage,
      flights,
      places: [],
      lifeEvents: [],
    })

    expect(content.flights).toHaveLength(1)
    expect(content.places).toEqual([])
    expect(content.lifeEvents).toEqual([])
  })

  test("loads every photograph in the media collection", () => {
    const content = createPhotographyContent({
      page: photographyPage,
      photographs: [
        { src: "/media/photography/one.jpg", year: 2024 },
        { src: "/media/photography/two.jpg" },
      ],
    })

    expect(content.photographs).toHaveLength(2)
  })
})
