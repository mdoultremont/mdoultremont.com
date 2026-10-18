import { Schema } from "effect"
import { actionsFor, NoInput } from "@/shared/actions/define"
import { AppSchema } from "@/shared/apps"
import { UserDirectorySchema } from "./schemas"

const action = actionsFor("backOffice")

const Apps = Schema.Array(AppSchema)

/**
 * User management. At least one user always keeps the back office, and nobody
 * can remove themselves or their own back office access.
 */
export const backOfficeActions = {
  users: {
    list: action({
      description:
        "Every user who was not removed, with their sign-in providers and app access, and every pending invitation.",
      effect: "read",
      http: { method: "GET", path: "/back-office/users" },
      input: NoInput,
      output: UserDirectorySchema,
    }),
    setAccess: action({
      description:
        "Replaces the apps a user may use (`music`, `backOffice`, `flights`).",
      effect: "write",
      http: { method: "PUT", path: "/back-office/users/:userId/access" },
      input: Schema.Struct({ userId: Schema.String, apps: Apps }),
      output: Schema.Struct({ status: Schema.Literal("saved") }),
    }),
    remove: action({
      description:
        "Removes a user: they can no longer sign in and lose all app access. Their data stays, and a new invitation restores them.",
      effect: "write",
      http: { method: "DELETE", path: "/back-office/users/:userId" },
      input: Schema.Struct({ userId: Schema.String }),
      output: Schema.Struct({ status: Schema.Literal("removed") }),
    }),
  },
  invitations: {
    create: action({
      description:
        "Emails an invitation link, valid for 7 days and usable once, that gives the chosen app access.",
      effect: "write",
      http: { method: "POST", path: "/back-office/invitations" },
      input: Schema.Struct({ email: Schema.String, apps: Apps }),
      output: Schema.Struct({ status: Schema.Literal("sent") }),
    }),
    resend: action({
      description:
        "Emails a new link for a pending invitation, valid for 7 more days. The previous link stops working.",
      effect: "write",
      http: {
        method: "POST",
        path: "/back-office/invitations/:invitationId/resend",
      },
      input: Schema.Struct({ invitationId: Schema.String }),
      output: Schema.Struct({ status: Schema.Literal("sent") }),
    }),
    revoke: action({
      description: "Revokes a pending invitation so its link stops working.",
      effect: "write",
      http: {
        method: "DELETE",
        path: "/back-office/invitations/:invitationId",
      },
      input: Schema.Struct({ invitationId: Schema.String }),
      output: Schema.Struct({ status: Schema.Literal("revoked") }),
    }),
  },
}
