import { env } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"
import { MusicClassification } from "@/backend/features/music/classification"
import { MusicPipeline } from "@/backend/features/music/pipeline"
import { platformLayer } from "../../platform"
import {
  decodeBody,
  json,
  type RequestError,
  requireMutation,
  requireOwner,
  respond,
} from "../http"

type ClassificationRouteError =
  | Effect.Error<ReturnType<MusicClassification["Service"]["reclassify"]>>
  | Effect.Error<ReturnType<MusicPipeline["Service"]["setReady"]>>

const route = (
  request: Request,
  options: { readonly mutation: boolean },
  handler: (
    ownerId: string
  ) => Effect.Effect<
    Response,
    RequestError | ClassificationRouteError,
    MusicClassification | MusicPipeline
  >
) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireOwner(request)
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(owner.id).pipe(
        Effect.catchTags({
          SetupIncomplete: (error) =>
            Effect.succeed(json({ error: error.message }, 409)),
          ClassificationPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          DestinationPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          JobQueueError: (error) =>
            Effect.succeed(json({ error: error.message }, 503)),
        }),
        Effect.provide(
          Layer.mergeAll(MusicClassification.layer, MusicPipeline.layer).pipe(
            Layer.provide(platformLayer(env))
          )
        )
      )
    })
  )

export const getClassification = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    MusicClassification.use((classification) =>
      classification.status(ownerId)
    ).pipe(Effect.map(json))
  )

/** Replaces every decision, e.g. after adding or rewording a destination. */
export const postReclassify = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const classification = yield* MusicClassification
      yield* classification.reclassify(ownerId)
      return json(yield* classification.status(ownerId), 202)
    })
  )

const ReadyBody = Schema.Struct({ ready: Schema.Boolean })

/** Turns classification on or off. Turning it on requires a complete setup. */
export const putReady = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const { ready } = yield* decodeBody(
        request,
        ReadyBody,
        "Invalid ready state"
      )
      const pipeline = yield* MusicPipeline
      return json({ ready: yield* pipeline.setReady(ownerId, ready) })
    })
  )
