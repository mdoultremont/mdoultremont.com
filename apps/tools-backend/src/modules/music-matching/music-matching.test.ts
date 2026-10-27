import { describe, expect, it } from "vitest"
import { artistKey, creditNames, sameTitle, titleKey, withoutFeatures } from "."

describe("music matching", () => {
  it("drops reissue notes and featured artists but keeps mix names", () => {
    expect(titleKey("Latch - Remastered 2013")).toBe("latch")
    expect(titleKey("Latch (Original Mix)")).toBe("latch")
    expect(titleKey("Latch (feat. Sam Smith)")).toBe("latch")
    expect(titleKey("Latch - Kaytranada Remix")).toBe("latch kaytranada remix")
    expect(
      sameTitle("Latch (Kaytranada remix)", "Latch - Kaytranada Remix")
    ).toBe(true)
    expect(sameTitle("Latch", "Latch (Kaytranada Remix)")).toBe(false)
    expect(sameTitle("Latch (Extended Mix)", "Latch (Radio Edit)")).toBe(false)
  })

  it("removes featured artists without eating mix names or titles", () => {
    expect(withoutFeatures("Latch (feat. Sam Smith)")).toBe("Latch")
    expect(withoutFeatures("Latch [Ft. Sam Smith]")).toBe("Latch")
    expect(withoutFeatures("Stay (with Justin Bieber)")).toBe("Stay")
    expect(withoutFeatures("Song (With Love)")).toBe("Song (With Love)")
    expect(withoutFeatures("Five ft Seven")).toBe("Five ft Seven")
    expect(titleKey("Song feat. X - Jamie xx Remix")).toBe(
      "song jamie xx remix"
    )
    expect(titleKey("Song Feat. X (Remix)")).toBe("song remix")
  })

  it("compares accents, case, and punctuation loosely", () => {
    expect(sameTitle("Pájaros de Barro", "PAJAROS DE BARRO")).toBe(true)
    expect(sameTitle("Rock & Roll", "Rock and Roll")).toBe(true)
  })

  it("finds an artist inside a credit", () => {
    expect(artistKey("The Chemical Brothers")).toBe("chemical brothers")
    expect(artistKey("Burial (2)")).toBe("burial")
    expect(creditNames("Disclosure feat. Sam Smith", "Sam Smith")).toBe(true)
    expect(creditNames("Simon & Garfunkel", "Simon & Garfunkel")).toBe(true)
    expect(creditNames("Samsmith", "Sam")).toBe(false)
    expect(creditNames("Kid Cudi", "Kid")).toBe(false)
    expect(creditNames("John Smith Band", "John Smith")).toBe(false)
    expect(creditNames("A, B & C", "B")).toBe(true)
    expect(creditNames("Artist", "")).toBe(false)
  })
})
