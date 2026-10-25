import { describe, expect, test } from "vitest"
import { appAt, pageAt } from "./catalog"

describe("music navigation", () => {
  test("keeps the section active for its nested playlist route", () => {
    const music = appAt("/music/input/123")!
    expect(music.id).toBe("music")
    expect(pageAt(music, "/music/output/playlists/123")?.label).toBe(
      "Output playlists"
    )
    expect(pageAt(music, "/music/output/")?.label).toBe("Output playlists")
    expect(pageAt(music, "/music/settings")?.label).toBe("Settings")
    expect(pageAt(music, "/music/input-other")).toBeUndefined()
    expect(appAt("/music-other")).toBeUndefined()
  })
})
