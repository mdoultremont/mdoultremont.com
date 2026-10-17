import { Clock, Effect } from "effect"

const lifetimeSeconds = 600

/**
 * Signed, expiring OAuth `state` bound to the app session that started the
 * flow. The key is the session's server-side ID, which the browser never sees.
 */
export const createSpotifyOAuthState = Effect.fn("createSpotifyOAuthState")(
  function* (sessionId: string) {
    const now = yield* Clock.currentTimeMillis
    return yield* Effect.promise(() => signState(sessionId, now))
  }
)

export const verifySpotifyOAuthState = Effect.fn("verifySpotifyOAuthState")(
  function* (state: string, sessionId: string) {
    const now = yield* Clock.currentTimeMillis
    return yield* Effect.promise(() => verifyState(state, sessionId, now))
  }
)

async function signState(sessionId: string, now: number): Promise<string> {
  const nonce = encode(crypto.getRandomValues(new Uint8Array(24)))
  const payload = `${nonce}.${Math.floor(now / 1000) + lifetimeSeconds}`
  const signature = await crypto.subtle.sign(
    "HMAC",
    await stateKey(sessionId),
    new TextEncoder().encode(payload)
  )
  return `${payload}.${encode(new Uint8Array(signature))}`
}

async function verifyState(
  state: string,
  sessionId: string,
  now: number
): Promise<boolean> {
  const parts = state.split(".")
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/u.test(parts[0] ?? ""))
    return false
  const expiresAt = Number(parts[1])
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(now / 1000))
    return false
  const payload = `${parts[0]}.${parts[1]}`
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await stateKey(sessionId),
      decode(parts[2] ?? ""),
      new TextEncoder().encode(payload)
    )
  } catch {
    return false
  }
}

async function stateKey(sessionId: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionId),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0)
  )
  return new Uint8Array(bytes)
}
