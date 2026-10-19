import { Effect } from "effect"
import { Users } from "#backend/actions/back-office/users"
import { catalog } from "@mdoultremont/tools-contracts"
import { bind } from "./bind"

const actions = catalog.backOffice

export const backOfficeHandlers = {
  users: {
    list: bind(actions.users.list, Users.layer, () =>
      Users.use((users) => users.list())
    ),
    setAccess: bind(actions.users.setAccess, Users.layer, (input, caller) =>
      Users.use((users) =>
        users.setAccess({ actorId: caller.userId, ...input })
      ).pipe(Effect.as({ status: "saved" } as const))
    ),
    remove: bind(actions.users.remove, Users.layer, (input, caller) =>
      Users.use((users) =>
        users.remove({ actorId: caller.userId, ...input })
      ).pipe(Effect.as({ status: "removed" } as const))
    ),
  },
  invitations: {
    create: bind(actions.invitations.create, Users.layer, (input, caller) =>
      Users.use((users) =>
        users.invite({
          ...input,
          invitedBy: caller.userId,
          origin: caller.origin,
        })
      ).pipe(Effect.as({ status: "sent" } as const))
    ),
    resend: bind(actions.invitations.resend, Users.layer, (input, caller) =>
      Users.use((users) =>
        users.resendInvitation({ ...input, origin: caller.origin })
      ).pipe(Effect.as({ status: "sent" } as const))
    ),
    revoke: bind(actions.invitations.revoke, Users.layer, (input) =>
      Users.use((users) => users.revokeInvitation(input.invitationId)).pipe(
        Effect.as({ status: "revoked" } as const)
      )
    ),
  },
}
