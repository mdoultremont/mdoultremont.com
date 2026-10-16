import { Data, Effect } from "effect"

export class CompressionError extends Data.TaggedError("CompressionError")<{
  readonly reason: "CompressionFailed" | "DecompressionFailed" | "InvalidData"
  readonly message: string
  readonly cause: unknown
}> {}

/** Workers-native gzip of UTF-8 text; returns the compressed bytes. */
export const gzipText = (text: string) =>
  Effect.tryPromise({
    try: async () => {
      const input = new Blob([new TextEncoder().encode(text)]).stream()
      return new Uint8Array(
        await new Response(
          input.pipeThrough(new CompressionStream("gzip"))
        ).arrayBuffer()
      )
    },
    catch: (cause) =>
      new CompressionError({
        reason: "CompressionFailed",
        message: "Could not compress the track",
        cause,
      }),
  })

export const gunzipText = (bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const input = new Blob([new Uint8Array(bytes)]).stream()
      const output = await new Response(
        input.pipeThrough(new DecompressionStream("gzip"))
      ).arrayBuffer()
      // Response.text() strips a UTF-8 BOM; decode manually so stored text round-trips exactly.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        output
      )
    },
    catch: (cause) =>
      new CompressionError({
        reason: "DecompressionFailed",
        message: "Could not read the stored track",
        cause,
      }),
  })
