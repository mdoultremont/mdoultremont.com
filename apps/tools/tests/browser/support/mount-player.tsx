import { createRoot } from "react-dom/client"
import type { PlayerStatus } from "@mdoultremont/tools-contracts/music"
import {
  MiniPlayer,
  PlayerProvider,
  TrackPlayButton,
} from "../../../src/features/music/player"

export interface PlayerFixtureOptions {
  readonly status?: PlayerStatus
  readonly statuses?: readonly PlayerStatus[]
  readonly commandError?: { readonly message: string; readonly data?: unknown }
}

export interface PlayerFixture {
  readonly calls: Array<
    | { readonly kind: "status"; readonly at: number }
    | {
        readonly kind: "play"
        readonly deviceId: string
        readonly trackId: string
      }
    | { readonly kind: "pause" | "resume" | "next"; readonly deviceId: string }
  >
  readonly setStatus: (status: PlayerStatus) => void
  readonly deferNextStatus: () => void
  readonly resolveDeferredStatus: () => void
  readonly unmount: () => void
}

declare global {
  interface Window {
    playerFixture: PlayerFixture
  }
}

const fixtureStatus: PlayerStatus = {
  status: "ready",
  devices: [
    {
      controllable: true,
      id: "fixture-speaker",
      name: "Fixture Speaker",
      type: "Speaker",
      active: true,
    },
    {
      controllable: true,
      id: "fixture-phone",
      name: "Fixture Phone",
      type: "Smartphone",
      active: false,
    },
  ],
  playback: {
    playing: false,
    device: {
      id: "fixture-speaker",
      name: "Fixture Speaker",
      restricted: false,
    },
    item: {
      kind: "track",
      id: "fixture-track",
      name: "Fixture Song",
      artistNames: ["Fixture Artist"],
      imageUrl: null,
      durationMs: null,
    },
    progressMs: null,
    allows: { pause: true, resume: true, next: true },
  },
}

export function mountPlayer(options: PlayerFixtureOptions = {}) {
  let currentStatus = options.status ?? fixtureStatus
  const statusQueue = [...(options.statuses ?? [])]
  const calls: PlayerFixture["calls"] = []
  let deferredStatus: (() => void) | null = null
  let deferStatus = false
  let root: ReturnType<typeof createRoot> | null = null

  const fixture: PlayerFixture = {
    calls,
    setStatus(status) {
      currentStatus = status
    },
    deferNextStatus() {
      deferStatus = true
    },
    resolveDeferredStatus() {
      deferredStatus?.()
    },
    unmount() {
      root?.unmount()
      root = null
      element.remove()
    },
  }
  window.playerFixture = fixture

  const client = {
    async token() {
      return { accessToken: "fixture-sdk-token" }
    },
    async status() {
      calls.push({ kind: "status", at: Date.now() })
      if (deferStatus) {
        deferStatus = false
        await new Promise<void>((resolve) => {
          deferredStatus = resolve
        })
        deferredStatus = null
      }
      return statusQueue.shift() ?? currentStatus
    },
    async play(input: { deviceId: string; trackId: string }) {
      calls.push({ kind: "play", ...input })
      if (options.commandError) throw options.commandError
      return { status: "accepted" as const }
    },
    async pause(input: { deviceId: string }) {
      calls.push({ kind: "pause", ...input })
      if (options.commandError) throw options.commandError
      return { status: "accepted" as const }
    },
    async resume(input: { deviceId: string }) {
      calls.push({ kind: "resume", ...input })
      if (options.commandError) throw options.commandError
      return { status: "accepted" as const }
    },
    async next(input: { deviceId: string }) {
      calls.push({ kind: "next", ...input })
      if (options.commandError) throw options.commandError
      return { status: "accepted" as const }
    },
  }

  const element = document.createElement("main")
  element.dataset.fixture = "injected-player-client"
  document.body.appendChild(element)
  root = createRoot(element)
  root.render(
    <PlayerProvider client={client}>
      <MiniPlayer variant="sidebar" />
      <TrackPlayButton
        track={{
          kind: "track",
          id: "fixture-track",
          name: "Fixture Song",
          artistNames: ["Fixture Artist"],
          imageUrl: null,
          durationMs: 200_000,
        }}
      />
    </PlayerProvider>
  )
}
