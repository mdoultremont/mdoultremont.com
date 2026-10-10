import { env } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"
import { MusicDelivery } from "@/backend/features/music/delivery"
import { platformLayer } from "../../platform"
import {
  decodeBody,
  json,
  type RequestError,
  requireMutation,
  requireOwner,
  respond,
} from "../http"

type DeliveryRouteError =
  | Effect.Error<ReturnType<MusicDelivery["Service"]["status"]>>
  | Effect.Error<ReturnType<MusicDelivery["Service"]["setAutomatic"]>>

const route = (
  request: Request,
  options: { readonly mutation: boolean },
  handler: (
    ownerId: string
  ) => Effect.Effect<Response, RequestError | DeliveryRouteError, MusicDelivery>
) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireOwner(request)
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(owner.id).pipe(
        Effect.catchTags({
          DeliveryPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          DestinationPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          JobQueueError: (error) =>
            Effect.succeed(json({ error: error.message }, 503)),
        }),
        Effect.provide(
          MusicDelivery.layer.pipe(Layer.provide(platformLayer(env)))
        )
      )
    })
  )

export const getDelivery = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    MusicDelivery.use((delivery) => delivery.status(ownerId)).pipe(
      Effect.map(json)
    )
  )

/** "Write now": queues delivery of every decision not yet written. */
export const postDelivery = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const delivery = yield* MusicDelivery
      yield* delivery.request(ownerId)
      return json(yield* delivery.status(ownerId), 202)
    })
  )

const AutomaticBody = Schema.Struct({ automatic: Schema.Boolean })

export const putDelivery = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const { automatic } = yield* decodeBody(
        request,
        AutomaticBody,
        "Invalid delivery setting"
      )
      const delivery = yield* MusicDelivery
      yield* delivery.setAutomatic(ownerId, automatic)
      return json(yield* delivery.status(ownerId))
    })
  )
