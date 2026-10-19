import { createORPCClient, ORPCError } from "@orpc/client"
import { RPCLink, type RPCLinkOptions } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { Schema } from "effect"
import { actionAt, catalog } from "./catalog"
import type { ActionsContract } from "./contract"

/** Typed client for every action; see `actionsContract`. */
export type ActionsClient = ContractRouterClient<ActionsContract>

/**
 * A client for /api/rpc. Each call encodes its input to the action's
 * canonical JSON and decodes the JSON output, so callers send and receive the
 * schemas' own values. Failures throw `ORPCError` with a readable message;
 * the code is one of `ActionErrorCode`.
 */
export const createActionsClient = (
  options: Omit<RPCLinkOptions<Record<never, never>>, "interceptors">
): ActionsClient =>
  createORPCClient(
    new RPCLink({
      ...options,
      interceptors: [
        async ({ next, ...call }) => {
          const spec = actionAt(catalog, call.path)
          if (spec === undefined)
            throw new ORPCError("NOT_FOUND", {
              message: `Unknown action ${call.path.join(".")}`,
            })
          const input = await Schema.encodeUnknownPromise(
            Schema.toCodecJson(spec.input)
          )(call.input ?? {}).catch((cause: unknown) => {
            throw new ORPCError("BAD_REQUEST", {
              message: cause instanceof Error ? cause.message : "Invalid input",
              cause,
            })
          })
          return Schema.decodeUnknownPromise(Schema.toCodecJson(spec.output))(
            await next({ ...call, input })
          )
        },
      ],
    })
  )
