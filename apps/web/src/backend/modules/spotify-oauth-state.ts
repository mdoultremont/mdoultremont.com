const lifetimeSeconds = 600

export async function createSpotifyOAuthState(
  sessionToken: string,
  now = Date.now()
): Promise<string> {
  const nonce = encode(crypto.getRandomValues(new Uint8Array(24)))
  const payload = `${nonce}.${Math.floor(now / 1000) + lifetimeSeconds}`
  const signature = await crypto.subtle.sign(
    "HMAC",
    await stateKey(sessionToken),
    new TextEncoder().encode(payload)
  )
  return `${payload}.${encode(new Uint8Array(signature))}`
}

export async function verifySpotifyOAuthState(
  state: string,
  sessionToken: string,
  now = Date.now()
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
      await stateKey(sessionToken),
      decode(parts[2] ?? ""),
      new TextEncoder().encode(payload)
    )
  } catch {
    return false
  }
}

async function stateKey(sessionToken: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionToken),
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
