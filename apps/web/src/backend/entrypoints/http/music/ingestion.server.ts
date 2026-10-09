import { env } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"
import { MusicIngestion } from "@/backend/features/music/ingestion"
import { platformLayer } from "../../platform"
import {
  decodeBody,
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
    RequestError | Effect.Error<ReturnType<MusicIngestion["Service"]["start"]>>,
    MusicIngestion
  >
) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireOwner(request)
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(owner.id).pipe(
        Effect.catchTags({
          IngestionPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          JobQueueError: (error) =>
            Effect.succeed(json({ error: error.message }, 503)),
        }),
        Effect.provide(
          MusicIngestion.layer.pipe(Layer.provide(platformLayer(env)))
        )
      )
    })
  )

export const getIngestion = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    MusicIngestion.use((ingestion) => ingestion.status(ownerId)).pipe(
      Effect.map(json)
    )
  )

const StartBody = Schema.Struct({
  kind: Schema.Literals(["full", "incremental"]),
})

export const postIngestion = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const { kind } = yield* decodeBody(
        request,
        StartBody,
        "Invalid ingestion"
      )
      const ingestion = yield* MusicIngestion
      return json(yield* ingestion.start(ownerId, kind), 202)
    })
  )
