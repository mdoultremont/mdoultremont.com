import {
  type ContractProcedure,
  oc,
  type Schema as WireSchema,
} from "@orpc/contract"
import { Schema } from "effect"
import { catalog } from "./catalog"
import {
  type ActionTree,
  type AnyActionSpec,
  type InputSchema,
  isActionSpec,
  type OutputSchema,
} from "./define"

/** Inputs whose fields are all optional may be omitted. */
type ClientInput<T> = {} extends T ? T | undefined : T

/** Turns what the browser holds into the JSON the server decodes. */
type InputCodec<I extends InputSchema> = WireSchema<
  ClientInput<I["Type"]>,
  Schema.Json
>
/** Turns the JSON the server encoded into what the browser holds. */
type OutputCodec<O extends OutputSchema> = WireSchema<Schema.Json, O["Type"]>

export type ContractOf<T> = {
  readonly [K in keyof T]: T[K] extends AnyActionSpec
    ? ContractProcedure<
        InputCodec<T[K]["input"]>,
        OutputCodec<T[K]["output"]>,
        Record<never, never>,
        Record<never, never>
      >
    : ContractOf<T[K]>
}

const inputCodec = <I extends InputSchema>(schema: I): InputCodec<I> => {
  const encode = Schema.toStandardSchemaV1(
    Schema.flip(Schema.toCodecJson(schema))
  )["~standard"]
  return {
    "~standard": {
      version: 1,
      vendor: encode.vendor,
      validate: (value) => encode.validate(value ?? {}),
    },
  }
}

const outputCodec = <O extends OutputSchema>(schema: O): OutputCodec<O> =>
  Schema.toStandardSchemaV1(Schema.toCodecJson(schema))

const procedure = (spec: AnyActionSpec) =>
  oc.input(inputCodec(spec.input)).output(outputCodec(spec.output))

function toContract<T extends ActionTree>(tree: T): ContractOf<T>
function toContract(tree: ActionTree) {
  return Object.fromEntries(
    Object.entries(tree).map(([key, node]) => [
      key,
      isActionSpec(node) ? procedure(node) : toContract(node),
    ])
  )
}

/**
 * The oRPC contract of every action, served at /api/rpc/<path> (for example
 * /api/rpc/flights/list). Its schemas convert between what the browser holds
 * and the canonical JSON on the wire; `createActionsClient` applies them.
 * The server does not implement this contract with oRPC validation: it
 * decodes and encodes each action exactly once in its invocation path.
 */
export const actionsContract: ContractOf<typeof catalog> = toContract(catalog)
export type ActionsContract = typeof actionsContract
