import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import type { PlayerStatus } from "@mdoultremont/tools-contracts/music"
import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
} from "./player-state"
import { MiniPlayer, PlayerProvider, TrackPlayButton } from "./player"

const ready: PlayerStatus = {
  status: "ready",
  devices: [
    {
      controllable: true,
      id: "speaker",
      name: "Kitchen",
      type: "Speaker",
      active: true,
    },
  ],
  playback: {
    playing: false,
    device: { id: "speaker", name: "Kitchen", restricted: false },
    item: {
      kind: "track",
      id: "trackA",
      name: "Song",
      artistNames: ["Artist"],
      imageUrl: null,
    },
    allows: { pause: true, resume: true, next: true },
  },
}
const loaded = (data: PlayerStatus = ready) =>
  playerReducer(initialPlayerState, {
    type: "loaded",
    epoch: 0,
    seq: 1,
    data,
    now: 0,
  })
type Client = NonNullable<ComponentProps<typeof PlayerProvider>["client"]>

function render(initialState: PlayerState) {
  const client = {
    token: vi.fn<Client["token"]>(),
    status: vi.fn<Client["status"]>(),
    play: vi.fn<Client["play"]>(),
    pause: vi.fn<Client["pause"]>(),
    resume: vi.fn<Client["resume"]>(),
    next: vi.fn<Client["next"]>(),
  }
  const html = renderToStaticMarkup(
    createElement(
      PlayerProvider,
      { initialState, client },
      createElement(MiniPlayer, { variant: "sidebar" }),
      createElement(TrackPlayButton, { trackId: "trackA", name: "Song" })
    )
  )
  expect(
    Object.values(client).every((method) => method.mock.calls.length === 0)
  ).toBe(true)
  return html
}
const disabledRow =
  /<button(?=[^>]*aria-label="Play Song")(?=[^>]*disabled="")[^>]*>/

describe("Spotify player rendering", () => {
  test("shows the playback permission upgrade and Premium requirement", () => {
    const html = render(loaded({ status: "needs_permission" }))
    expect(html).toContain('href="/api/music/spotify/connect"')
    expect(html).toContain("Allow playback")
    expect(html).toContain("Spotify Premium")
    expect(html).toMatch(disabledRow)
  })
  test("explains how to make a device available", () => {
    const html = render(
      loaded({ status: "ready", devices: [], playback: null })
    )
    expect(html).toContain("No devices found. Open Spotify on a device")
    expect(html).toContain("Nothing playing")
    expect(html).toMatch(disabledRow)
  })
  test("explains restricted devices without offering playback", () => {
    const html = render(
      loaded({
        status: "ready",
        devices: [
          {
            controllable: false,
            why: "restricted",
            name: "TV",
            type: "TV",
            active: true,
          },
        ],
        playback: null,
      })
    )
    expect(html).toContain("These devices cannot be controlled")
    expect(html).toMatch(disabledRow)
  })
  test("shows paused playback separately from the future track target", () => {
    const html = render(loaded())
    expect(html).toContain("Paused")
    expect(html).toContain("Kitchen")
    expect(html).toContain("Play tracks on")
    expect(html).toContain('aria-label="Resume playback"')
    expect(html).not.toMatch(disabledRow)
    expect(html).not.toContain('data-playing="true"')
    expect(html).not.toContain("<img")
  })
  test("pending requests disable controls and do not claim playback started", () => {
    const pending = playerReducer(loaded(), {
      type: "start",
      command: {
        kind: "play",
        deviceId: "speaker",
        trackId: "trackA",
        nextTrackIds: [],
      },
      now: 0,
    })
    const html = render(
      playerReducer(pending, { type: "accepted", epoch: pending.epoch, now: 0 })
    )
    expect(html).toContain("Waiting for Spotify")
    expect(html).toContain("Paused")
    expect(html).toMatch(disabledRow)
  })
  test("stale observations explain why controls are unavailable", () => {
    const html = render(
      playerReducer(loaded(), {
        type: "failed",
        epoch: 0,
        seq: 2,
        failure: { message: "Spotify is temporarily unavailable" },
        now: 0,
      })
    )
    expect(html).toContain("Playback is out of date")
    expect(html).toContain("Spotify is temporarily unavailable")
    expect(html).toMatch(disabledRow)
  })
  test("only actual observed playback marks the matching row", () => {
    const html = render(
      loaded({ ...ready, playback: { ...ready.playback!, playing: true } })
    )
    expect(html).toContain('data-playing="true"')
    expect(html).toContain("lucide-audio-lines")
    expect(html).toContain('aria-label="Pause playback"')
  })

  test.each([
    { stale: true, connectionLost: false },
    { stale: false, connectionLost: true },
  ])("unavailable observations do not mark a row as playing (%j)", (flags) => {
    const html = render({
      ...loaded({ ...ready, playback: { ...ready.playback!, playing: true } }),
      ...flags,
    })
    expect(html).toMatch(disabledRow)
    expect(html).not.toContain('data-playing="true"')
    expect(html).not.toContain("lucide-audio-lines")
  })
})
