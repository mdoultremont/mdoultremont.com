import { env } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"
import {
  Destinations,
  type DestinationsError,
} from "@/backend/features/music/destinations"
import { platformLayer } from "../platform"
import {
  decodeBody,
  json,
  type RequestError,
  requireMutation,
  requireOwner,
  respond,
  spotifyErrorResponse,
} from "./http"

/**
 * Signs in the owner, verifies mutations, runs the handler with the
 * Destinations feature, and turns every feature error into a response.
 */
const route = (
  request: Request,
  options: { readonly mutation: boolean },
  handler: (
    ownerId: string
  ) => Effect.Effect<Response, RequestError | DestinationsError, Destinations>
) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireOwner(request)
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(owner.id).pipe(
        Effect.catchTags({
          DestinationInputError: (error) =>
            Effect.succeed(json({ error: error.message }, 400)),
          PlaylistNotUsable: (error) =>
            Effect.succeed(json({ error: error.message }, 400)),
          DestinationConflict: (error) =>
            Effect.succeed(json({ error: error.message }, 409)),
          DestinationPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
          CreatedPlaylistConfigurationError: (error) =>
            Effect.succeed(
              json(
                { error: error.message, createdPlaylist: error.playlist },
                500
              )
            ),
          SpotifyError: (error) => Effect.succeed(spotifyErrorResponse(error)),
        }),
        Effect.provide(
          Destinations.layer.pipe(Layer.provide(platformLayer(env)))
        )
      )
    })
  )

export const getDestinations = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    Destinations.use((destinations) => destinations.read(ownerId)).pipe(
      Effect.map(json)
    )
  )

const SaveBody = Schema.Struct({
  playlistId: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
})

export const putDestination = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(request, SaveBody, "Invalid destination")
      const destinations = yield* Destinations
      const destination = yield* destinations.save({ ownerId, ...input })
      return json({ destination })
    })
  )

const RemoveBody = Schema.Struct({ playlistId: Schema.String })

export const deleteDestination = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(
        request,
        RemoveBody,
        "Invalid destination"
      )
      const destinations = yield* Destinations
      yield* destinations.remove({ ownerId, ...input })
      return json({ status: "removed" })
    })
  )

const CreateBody = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
})

export const postPrivateDestination = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(
        request,
        CreateBody,
        "Invalid destination"
      )
      const destinations = yield* Destinations
      return json(yield* destinations.create({ ownerId, ...input }), 201)
    })
  )

const ReviewBody = Schema.Struct({ playlistId: Schema.NullOr(Schema.String) })

export const putReviewPlaylist = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(
        request,
        ReviewBody,
        "Invalid review playlist"
      )
      const destinations = yield* Destinations
      const reviewPlaylistId = yield* destinations.setReviewPlaylist({
        ownerId,
        ...input,
      })
      return json({ reviewPlaylistId })
    })
  )
