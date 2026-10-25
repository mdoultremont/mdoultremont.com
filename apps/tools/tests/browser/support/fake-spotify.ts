import type { Page } from "@playwright/test"

export const fakeSpotifyScript = `
(() => {
  const listeners = new Map();
  window.fakeSpotify = {
    connected: false,
    disconnected: false,
    activatedInGesture: false,
    tokens: [],
    emit: (event, value = {}) => listeners.get(event)?.(value),
    requestToken: () => window.fakeSpotify.getOAuthToken((token) => window.fakeSpotify.tokens.push(token)),
  };
  window.Spotify = { Player: class {
    constructor(options) { window.fakeSpotify.getOAuthToken = options.getOAuthToken; }
    addListener(event, callback) { listeners.set(event, callback); }
    async connect() { window.fakeSpotify.connected = true; window.fakeSpotify.requestToken(); return true; }
    disconnect() { window.fakeSpotify.disconnected = true; }
    async activateElement() { window.fakeSpotify.activatedInGesture = navigator.userActivation.isActive; }
  }};
  window.onSpotifyWebPlaybackSDKReady?.();
})();
`

declare global {
  interface Window {
    fakeSpotify: {
      connected: boolean
      disconnected: boolean
      activatedInGesture: boolean
      tokens: string[]
      emit: (
        event: string,
        value?: { device_id?: string; message?: string }
      ) => void
      requestToken: () => void
    }
  }
}

export async function fakeSpotify(page: Page) {
  await page.route("https://sdk.scdn.co/spotify-player.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakeSpotifyScript })
  )
}
