import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { MusicEnrichment } from "@/backend/features/music/enrichment"
import { platformLayer } from "../../platform"
import {
  json,
  type RequestError,
  requireMutation,
  requireOwner,
  respond,
} from "../http"

const route = (
  request: Request,
  options: { readonly mutation: boolean },
  handler: (
    ownerId: string
  ) => Effect.Effect<
    Response,
    | RequestError
    | Effect.Error<ReturnType<MusicEnrichment["Service"]["retryUnresolved"]>>,
    MusicEnrichment
  >
) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireOwner(request)
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(owner.id).pipe(
        Effect.catchTags({
          EnrichmentPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          JobQueueError: (error) =>
            Effect.succeed(json({ error: error.message }, 503)),
        }),
        Effect.provide(
          MusicEnrichment.layer.pipe(Layer.provide(platformLayer(env)))
        )
      )
    })
  )

export const getEnrichment = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    MusicEnrichment.use((enrichment) => enrichment.status(ownerId)).pipe(
      Effect.map(json)
    )
  )

/** Looks up not-found, ambiguous, and failed ISRCs again. */
export const retryEnrichment = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const enrichment = yield* MusicEnrichment
      yield* enrichment.retryUnresolved(ownerId)
      return json(yield* enrichment.status(ownerId), 202)
    })
  )
