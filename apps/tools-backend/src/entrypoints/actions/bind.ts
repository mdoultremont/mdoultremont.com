import { Cause, Effect, Layer, Schema } from "effect"
import type { AnyActionSpec } from "@mdoultremont/tools-contracts"
import type { platformLayer } from "../platform"
import type { Caller } from "./caller"
import { ActionError, type BusinessError, toActionError } from "./errors"

export type PlatformLayer = ReturnType<typeof platformLayer>
/** What every action layer may require: the Worker's bindings and configuration. */
export type Platform = Layer.Success<PlatformLayer>

/** An action paired with its handler. Only `bind` creates one. */
export interface BoundAction<S extends AnyActionSpec = AnyActionSpec> {
  readonly spec: S
  /**
   * Decodes the canonical JSON input, runs the handler, and encodes its
   * output back to canonical JSON. Each happens exactly once per call.
   */
  readonly execute: (
    input: unknown,
    caller: Caller
  ) => Effect.Effect<Schema.Json, ActionError, Platform>
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength

/**
 * Pairs an action with the business code it runs. `layer` provides the
 * services `handler` uses, on top of the request's platform. The handler
 * receives decoded input and the caller, and returns the action's output;
 * every error it may raise must have a row in `toActionError`.
 */
export const bind = <
  S extends AnyActionSpec,
  R,
  E extends BusinessError,
  LE extends BusinessError,
>(
  spec: S,
  layer: Layer.Layer<R, LE, Platform>,
  handler: (
    input: S["input"]["Type"],
    caller: Caller
  ) => Effect.Effect<S["output"]["Type"], E, R>
): BoundAction<S> => {
  const decode = Schema.decodeUnknownEffect(Schema.toCodecJson(spec.input))
  const encode = Schema.encodeEffect(Schema.toCodecJson(spec.output))
  return {
    spec,
    execute: (raw, caller) =>
      Effect.gen(function* () {
        const input = yield* decode(raw).pipe(
          Effect.mapError(
            (error) =>
              new ActionError({ code: "BAD_REQUEST", message: error.message })
          )
        )
        if (spec.file) {
          const content = input[spec.file.contentField]
          if (
            typeof content === "string" &&
            utf8Bytes(content) > spec.file.maxBytes
          )
            return yield* new ActionError({
              code: "PAYLOAD_TOO_LARGE",
              message: `File content exceeds ${spec.file.maxBytes / 1_000_000} MB`,
            })
        }
        const output = yield* handler(input, caller).pipe(
          Effect.provide(layer),
          Effect.catch((error) =>
            toActionError(error).pipe(Effect.flatMap(Effect.fail))
          )
        )
        return yield* encode(output).pipe(Effect.orDie)
      }),
  }
}

export type ActionResult =
  | { readonly _tag: "Success"; readonly output: Schema.Json }
  | { readonly _tag: "Failure"; readonly error: ActionError }

/**
 * The single place where an action call leaves Effect, for every transport.
 * Checks the caller's app access, executes the action on the request's
 * platform, and logs unexpected defects before reporting a generic failure.
 */
export const invokeAction = (
  action: BoundAction,
  input: unknown,
  caller: Caller,
  platform: PlatformLayer
): Promise<ActionResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (!caller.apps.includes(action.spec.app))
        return yield* new ActionError({
          code: "FORBIDDEN",
          message: "You do not have access to this app",
        })
      if (action.spec.sessionOnly && caller.sessionAuthenticated !== true)
        return yield* new ActionError({
          code: "FORBIDDEN",
          message: "This action requires a browser session",
        })
      return yield* action.execute(input, caller)
    }).pipe(
      Effect.provide(platform),
      Effect.catchTag("ConfigError", (error) =>
        toActionError(error).pipe(Effect.flatMap(Effect.fail))
      ),
      Effect.map((output): ActionResult => ({ _tag: "Success", output })),
      Effect.catchTag("ActionError", (error) =>
        Effect.succeed<ActionResult>({ _tag: "Failure", error })
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Unhandled action failure", Cause.pretty(cause)).pipe(
          Effect.as<ActionResult>({
            _tag: "Failure",
            error: new ActionError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Request failed",
            }),
          })
        )
      )
    )
  )
