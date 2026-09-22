import { describe, expect, test } from "vitest"
import experiences from "../content/experiences.json"
import flights from "../content/flights.json"
import lifeEvents from "../content/life-events.json"
import personalPage from "../content/personal.json"
import photographyPage from "../content/photography-page.json"
import photographs from "../content/photography.json"
import places from "../content/places.json"
import professionalPage from "../content/professional.json"
import { createPersonalContent } from "./content/personal"
import { createPhotographyContent } from "./content/photography"
import { createProfessionalContent } from "./content/professional"

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
      { company: "Atlassian", period: "Aug 2025 – Present" },
      { company: "Cycle", period: "Oct 2024 – Aug 2025" },
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
      places,
      lifeEvents,
    })

    expect(content.flights).toHaveLength(1)
    expect(content.places).toEqual([])
    expect(content.lifeEvents).toEqual([])
  })

  test("loads every photograph in the media collection", () => {
    const content = createPhotographyContent({
      page: photographyPage,
      photographs,
    })

    expect(content.photographs).toHaveLength(84)
  })
})
