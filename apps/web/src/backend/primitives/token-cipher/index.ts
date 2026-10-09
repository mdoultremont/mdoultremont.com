import { Config, Context, Data, Effect, Layer, Redacted } from "effect"

export class TokenCipherError extends Data.TaggedError("TokenCipherError")<{
  readonly reason: "InvalidKey" | "InvalidCiphertext"
  readonly cause?: unknown
}> {
  override get message() {
    return this.reason === "InvalidKey"
      ? "Encryption key must be 32 base64-encoded bytes"
      : "Encrypted value cannot be read"
  }
}

/** AES-GCM encryption for secrets stored at rest. Ciphertext format: `base64(iv).base64(data)`. */
export class TokenCipher extends Context.Service<
  TokenCipher,
  {
    readonly encrypt: (
      plaintext: string
    ) => Effect.Effect<string, TokenCipherError>
    readonly decrypt: (
      ciphertext: string
    ) => Effect.Effect<string, TokenCipherError>
  }
>()("backend/primitives/TokenCipher") {
  static readonly layer = (key: Redacted.Redacted<string>) =>
    Layer.effect(
      TokenCipher,
      Effect.gen(function* () {
        // Imported on first use and memoized, so a bad key fails only the calls that need it.
        const cryptoKey = yield* Effect.cached(importKey(Redacted.value(key)))

        const encrypt = Effect.fn("TokenCipher.encrypt")(function* (
          plaintext: string
        ) {
          const keyValue = yield* cryptoKey
          const iv = crypto.getRandomValues(new Uint8Array(12))
          const ciphertext = yield* Effect.promise(() =>
            crypto.subtle.encrypt(
              { name: "AES-GCM", iv },
              keyValue,
              new TextEncoder().encode(plaintext)
            )
          )
          return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
        })

        const decrypt = Effect.fn("TokenCipher.decrypt")(function* (
          ciphertext: string
        ) {
          const keyValue = yield* cryptoKey
          const [iv, data] = ciphertext.split(".")
          if (!iv || !data)
            return yield* new TokenCipherError({ reason: "InvalidCiphertext" })
          const plaintext = yield* Effect.tryPromise({
            try: () =>
              crypto.subtle.decrypt(
                { name: "AES-GCM", iv: fromBase64(iv) },
                keyValue,
                fromBase64(data)
              ),
            catch: (cause) =>
              new TokenCipherError({ reason: "InvalidCiphertext", cause }),
          })
          return new TextDecoder().decode(plaintext)
        })

        return TokenCipher.of({ encrypt, decrypt })
      })
    )

  /** Reads the key from configuration, e.g. `TokenCipher.layerConfig("SPOTIFY_TOKEN_ENCRYPTION_KEY")`. */
  static readonly layerConfig = (name: string) =>
    Layer.unwrap(
      Effect.map(Config.Redacted(name), (key) => TokenCipher.layer(key))
    )
}

function importKey(encoded: string) {
  return Effect.gen(function* () {
    const bytes = yield* Effect.try({
      try: () => fromBase64(encoded),
      catch: (cause) => new TokenCipherError({ reason: "InvalidKey", cause }),
    })
    if (bytes.length !== 32)
      return yield* new TokenCipherError({ reason: "InvalidKey" })
    return yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
          "encrypt",
          "decrypt",
        ]),
      catch: (cause) => new TokenCipherError({ reason: "InvalidKey", cause }),
    })
  })
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  )
}
