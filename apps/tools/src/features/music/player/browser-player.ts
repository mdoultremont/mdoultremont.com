import { useEffect, useRef } from "react"
import type { PlayerEvent } from "./player-state"

type DeviceEvent = "ready" | "not_ready"
type ErrorEvent =
  | "initialization_error"
  | "authentication_error"
  | "account_error"
  | "playback_error"
  | "autoplay_failed"

interface BrowserPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  activateElement(): Promise<void>
  addListener(
    event: DeviceEvent,
    listener: (device: { device_id: string }) => void
  ): void
  addListener(
    event: ErrorEvent,
    listener: (error: { message: string }) => void
  ): void
}

interface PlaybackSdk {
  Player: new (options: {
    name: string
    getOAuthToken: (callback: (token: string) => void) => void
  }) => BrowserPlayer
}

declare global {
  interface Window {
    Spotify?: PlaybackSdk
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

let sdk: Promise<PlaybackSdk> | undefined

function loadSdk(): Promise<PlaybackSdk> {
  if (window.Spotify) return Promise.resolve(window.Spotify)
  sdk ??= new Promise<PlaybackSdk>((resolve, reject) => {
    const script = document.createElement("script")
    const previousReady = window.onSpotifyWebPlaybackSDKReady
    const timeout = setTimeout(() => fail(), 15_000)
    function fail() {
      clearTimeout(timeout)
      script.remove()
      window.onSpotifyWebPlaybackSDKReady = previousReady
      sdk = undefined
      reject(
        new Error(
          "Spotify's browser player could not load. Refresh the page to try again."
        )
      )
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout)
      previousReady?.()
      if (window.Spotify) resolve(window.Spotify)
      else fail()
    }
    script.src = "https://sdk.scdn.co/spotify-player.js"
    script.async = true
    script.addEventListener("error", fail, { once: true })
    document.head.appendChild(script)
  })
  return sdk
}

export function useBrowserPlayer(
  enabled: boolean,
  token: () => Promise<{ readonly accessToken: string }>,
  send: (event: PlayerEvent) => void,
  refresh: () => void
) {
  const player = useRef<BrowserPlayer | null>(null)
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let instance: BrowserPlayer | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const unavailable = (message: string) => {
      if (!disposed)
        send({ type: "browser", device: { status: "unavailable", message } })
    }
    send({ type: "browser", device: { status: "connecting" } })
    async function initialize() {
      try {
        const Spotify = await loadSdk()
        if (disposed) return
        instance = new Spotify.Player({
          name: "Tools browser player",
          getOAuthToken: async (callback) => {
            try {
              const { accessToken } = await token()
              if (!disposed) callback(accessToken)
            } catch {
              unavailable(
                "Spotify could not authorize this browser. Connect Spotify again or reload the page."
              )
            }
          },
        })
        player.current = instance
        instance.addListener("ready", ({ device_id }) => {
          if (disposed) return
          send({
            type: "browser",
            device: { status: "ready", deviceId: device_id },
          })
          refresh()
          clearTimeout(refreshTimer)
          refreshTimer = setTimeout(refresh, 1000)
        })
        instance.addListener("not_ready", () => {
          unavailable(
            "This browser is offline. Reload the page to reconnect, or choose another device."
          )
          if (!disposed) refresh()
        })
        instance.addListener("initialization_error", () =>
          unavailable(
            "This browser cannot initialize Spotify audio. Try a browser with protected content enabled."
          )
        )
        instance.addListener("authentication_error", () =>
          unavailable(
            "Spotify could not authorize this browser. Connect Spotify again or reload the page."
          )
        )
        instance.addListener("account_error", () =>
          unavailable("Browser playback requires Spotify Premium.")
        )
        instance.addListener("playback_error", () =>
          unavailable(
            "Spotify could not play audio in this browser. Reload the page or choose another device."
          )
        )
        instance.addListener("autoplay_failed", () =>
          unavailable(
            "The browser blocked Spotify audio. Reload the page and click a track to enable audio."
          )
        )
        const connected = await instance.connect()
        if (!connected)
          unavailable(
            "Spotify could not connect this browser. Reload the page to try again."
          )
      } catch {
        unavailable(
          "Spotify's browser player could not load. Reload the page to try again."
        )
      }
    }
    void initialize()
    return () => {
      disposed = true
      clearTimeout(refreshTimer)
      player.current = null
      instance?.disconnect()
    }
  }, [enabled, token, send, refresh])
  return player
}
