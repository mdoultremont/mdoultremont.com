import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { errorReason } from "@mdoultremont/tools-contracts"

vi.mock("cloudflare:workers", () => ({ env: {} }))
import { code, makeHarness, origin } from "./testing"

const network = vi.fn<typeof fetch>(async () => {
  throw new Error("No network in tests")
})

let api: ReturnType<typeof makeHarness>
beforeEach(() => {
  vi.stubGlobal("fetch", network)
  api = makeHarness()
  api.d1.seedOwner()
  api.signIn(["music"])
})
afterEach(() => {
  api.close()
  vi.unstubAllGlobals()
})

const messages = () => api.jobs.mock.calls.map(([message]) => message)

describe("music actions", () => {
  test("read the owner's setup and pipeline status", async () => {
    expect(await api.client.music.destinations.get()).toEqual({
      destinations: [],
      reviewPlaylistId: null,
      ready: false,
    })
    expect(await api.client.music.ingestion.status()).toMatchObject({
      sources: [
        {
          sourceId: { kind: "liked" },
          enabled: true,
          present: 0,
          removed: 0,
          latest: null,
        },
      ],
      present: 0,
      removed: 0,
    })
    expect(await api.client.music.enrichment.status()).toMatchObject({
      enriched: 0,
      pending: 0,
    })
    expect(await api.client.music.classification.status()).toMatchObject({
      ready: false,
      decided: 0,
      recent: [],
    })
    expect(await api.client.music.delivery.status()).toEqual({
      automatic: false,
      delivered: 0,
      toWrite: 0,
      refused: 0,
      lastDeliveredAt: null,
    })
  })

  test("start background work and return at once", async () => {
    const {
      ingestions: [ingestion],
    } = await api.client.music.ingestion.start({ kind: "full" })
    expect(ingestion).toMatchObject({
      kind: "full",
      status: "queued",
      ownerId: "owner",
    })
    expect(messages()).toContainEqual({
      kind: "music.ingestion",
      ingestionId: ingestion!.id,
    })
    expect(
      (await api.client.music.ingestion.start({ kind: "incremental" }))
        .ingestions[0]?.id
    ).toBe(ingestion!.id)
    expect(
      await code(api.client.music.ingestion.start({ kind: "partial" } as never))
    ).toBe("BAD_REQUEST")

    expect(await api.client.music.enrichment.retry()).toMatchObject({
      pending: 0,
    })
    expect(await api.client.music.classification.reclassify()).toMatchObject({
      decided: 0,
    })
    expect(await api.client.music.delivery.start()).toMatchObject({
      toWrite: 0,
    })
    expect(messages()).toContainEqual({
      kind: "music.delivery",
      ownerId: "owner",
    })
    expect(
      await api.client.music.delivery.setAutomatic({ automatic: true })
    ).toMatchObject({ automatic: true })
    expect((await api.client.music.delivery.status()).automatic).toBe(true)
  })

  test("refuse incomplete setups and invalid destinations", async () => {
    const notReady = await api.client.music.classification
      .setReady({ ready: true })
      .catch((error: unknown) => error)
    expect(notReady).toMatchObject({
      code: "CONFLICT",
      message: "Choose a review playlist before starting classification",
    })
    expect(
      await api.client.music.classification.setReady({ ready: false })
    ).toEqual({
      ready: false,
    })
    expect(
      await api.client.music.destinations.setReviewPlaylist({
        playlistId: null,
      })
    ).toEqual({ reviewPlaylistId: null })
    const invalid = await api.request(
      `/api/v1/music/destinations/${encodeURIComponent("not valid!")}`,
      { method: "DELETE", headers: { Origin: origin } }
    )
    expect(await invalid.json()).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "Choose a valid Spotify playlist",
      },
    })
    expect(
      await api.client.music.destinations.remove({ playlistId: "jazz" })
    ).toEqual({ status: "removed" })
    expect(
      await code(
        api.client.music.destinations.create({ name: " ", description: "" })
      )
    ).toBe("BAD_REQUEST")
  })

  test("check playlists with Spotify before saving them", async () => {
    for (const call of [
      api.client.music.destinations.save({
        playlistId: "jazz",
        description: "Improvised acoustic music",
        enabled: true,
      }),
      api.client.music.destinations.create({ name: "Focus", description: "" }),
      api.client.music.destinations.setReviewPlaylist({ playlistId: "review" }),
    ]) {
      const error = await call.catch((cause: unknown) => cause)
      expect(error).toMatchObject({ code: "CONFLICT" })
      expect(errorReason(error)).toBe("ReconnectNeeded")
    }
    expect((await api.client.music.destinations.get()).destinations).toEqual([])
  })

  test("report Spotify problems with their reason", async () => {
    expect(await api.client.music.spotify.connect()).toEqual({
      url: `${origin}/api/music/spotify/connect`,
    })
    const reconnect = await api.client.music.spotify
      .playlists()
      .catch((error: unknown) => error)
    expect(reconnect).toMatchObject({ code: "CONFLICT" })
    expect(errorReason(reconnect)).toBe("ReconnectNeeded")
    expect(await api.client.music.spotify.status()).toMatchObject({
      status: "reconnect_needed",
      accountId: "account",
    })
    expect(
      await code(
        api.client.music.spotify.likedTracks({
          cursor: "https://evil.example/v1/me/tracks",
        })
      )
    ).toBe("BAD_REQUEST")
    expect(await api.client.music.spotify.disconnect()).toEqual({
      status: "disconnected",
    })
    expect(await api.client.music.spotify.status()).toEqual({
      status: "disconnected",
    })
    const notConnected = await api.client.music.spotify
      .likedTracks({})
      .catch((error: unknown) => error)
    expect(errorReason(notConnected)).toBe("NotConnected")
    expect(network).not.toHaveBeenCalled()
  })
})
