import { Effect } from "effect"

/** Hex-encoded SHA-256 of a string. */
export const sha256Hex = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    )
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  })

/** A URL-safe random token with 256 bits of entropy, e.g. for sessions and OAuth state. */
export const randomToken = Effect.sync(() => {
  let binary = ""
  for (const byte of crypto.getRandomValues(new Uint8Array(32)))
    binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
})
