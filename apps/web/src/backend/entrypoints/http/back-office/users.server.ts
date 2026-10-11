import { env } from "cloudflare:workers"
import { Effect, Layer, Schema } from "effect"
import { AppSchema } from "@/backend/features/auth"
import { Users } from "@/backend/features/back-office/users"
import type {
  AlreadyAUser,
  InvitationNotFound,
  LastBackOfficeUser,
  OwnAccessProtected,
  UserDirectoryPersistenceError,
  UserInputError,
  UserNotFound,
} from "@/backend/features/back-office/users"
import type { EmailError } from "@/backend/modules/email"
import { platformLayer } from "../../platform"
import {
  decodeBody,
  json,
  type RequestError,
  requireApp,
  requireMutation,
  respond,
} from "../http"

type UsersError =
  | AlreadyAUser
  | InvitationNotFound
  | LastBackOfficeUser
  | OwnAccessProtected
  | UserDirectoryPersistenceError
  | UserInputError
  | UserNotFound
  | EmailError

/**
 * Checks back office access, verifies mutations, runs the handler with the
 * Users feature, and turns every feature error into a response.
 */
const route = (
  request: Request,
  options: { readonly mutation: boolean },
  handler: (
    actorId: string
  ) => Effect.Effect<Response, RequestError | UsersError, Users>
) =>
  respond(
    Effect.gen(function* () {
      const actor = yield* requireApp(request, "backOffice")
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(actor.id).pipe(
        Effect.catchTags({
          UserInputError: (error) =>
            Effect.succeed(json({ error: error.message }, 400)),
          AlreadyAUser: (error) =>
            Effect.succeed(json({ error: error.message }, 409)),
          LastBackOfficeUser: (error) =>
            Effect.succeed(json({ error: error.message }, 409)),
          OwnAccessProtected: (error) =>
            Effect.succeed(json({ error: error.message }, 409)),
          UserNotFound: (error) =>
            Effect.succeed(json({ error: error.message }, 404)),
          InvitationNotFound: (error) =>
            Effect.succeed(json({ error: error.message }, 404)),
          EmailError: (error) =>
            Effect.logError(
              "Invitation email failed",
              error.code,
              error.cause
            ).pipe(Effect.as(json({ error: error.message }, 502))),
          UserDirectoryPersistenceError: (error) =>
            Effect.succeed(json({ error: error.message }, 500)),
        }),
        Effect.provide(Users.layer.pipe(Layer.provide(platformLayer(env))))
      )
    })
  )

const origin = (request: Request) => new URL(request.url).origin

export const getUsers = (request: Request) =>
  route(request, { mutation: false }, () =>
    Users.use((users) => users.list()).pipe(Effect.map(json))
  )

const AccessBody = Schema.Struct({
  userId: Schema.String,
  apps: Schema.Array(AppSchema),
})

export const putUserAccess = (request: Request) =>
  route(request, { mutation: true }, (actorId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(request, AccessBody, "Invalid access")
      yield* Users.use((users) => users.setAccess({ actorId, ...input }))
      return json({ status: "saved" })
    })
  )

const UserBody = Schema.Struct({ userId: Schema.String })

export const deleteUser = (request: Request) =>
  route(request, { mutation: true }, (actorId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(request, UserBody, "Invalid user")
      yield* Users.use((users) => users.remove({ actorId, ...input }))
      return json({ status: "removed" })
    })
  )

const InviteBody = Schema.Struct({
  email: Schema.String,
  apps: Schema.Array(AppSchema),
})

export const postInvitation = (request: Request) =>
  route(request, { mutation: true }, (actorId) =>
    Effect.gen(function* () {
      const input = yield* decodeBody(request, InviteBody, "Invalid invitation")
      yield* Users.use((users) =>
        users.invite({ ...input, invitedBy: actorId, origin: origin(request) })
      )
      return json({ status: "sent" }, 201)
    })
  )

const InvitationBody = Schema.Struct({ invitationId: Schema.String })

export const postInvitationResend = (request: Request) =>
  route(request, { mutation: true }, () =>
    Effect.gen(function* () {
      const input = yield* decodeBody(
        request,
        InvitationBody,
        "Invalid invitation"
      )
      yield* Users.use((users) =>
        users.resendInvitation({ ...input, origin: origin(request) })
      )
      return json({ status: "sent" })
    })
  )

export const deleteInvitation = (request: Request) =>
  route(request, { mutation: true }, () =>
    Effect.gen(function* () {
      const input = yield* decodeBody(
        request,
        InvitationBody,
        "Invalid invitation"
      )
      yield* Users.use((users) => users.revokeInvitation(input.invitationId))
      return json({ status: "revoked" })
    })
  )
