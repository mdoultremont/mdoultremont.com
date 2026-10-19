import { Schema } from "effect"
import type { App } from "../apps"

/**
 * What calling an action does. A `read` changes nothing and may use GET; a
 * `write` changes data or starts work and never uses GET.
 */
export type ActionEffect = "read" | "write"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/**
 * An action's input: a JSON object. Every schema travels as its canonical
 * JSON form (`Schema.toCodecJson`), which is also what the manifest
 * describes, and needs no services to decode or encode.
 */
export type InputSchema = Schema.Codec<
  { readonly [key: string]: unknown },
  unknown,
  never,
  never
>
export type OutputSchema = Schema.Codec<unknown, unknown, never, never>

/**
 * The input of an action that takes none: an object without properties.
 * (`Schema.Struct({})` would accept any value but null.)
 */
export const NoInput = Schema.Record(Schema.String, Schema.Never)

/** Names of the declared fields whose encoded value is a string. */
export type StringField<I extends InputSchema> = {
  [K in keyof I["Encoded"] & string]-?: string extends K
    ? never
    : I["Encoded"][K] extends string
      ? K
      : never
}[keyof I["Encoded"] & string]

/** The `:name` segments of a route path. */
export type PathParams<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? Param | PathParams<`/${Rest}`>
    : P extends `${string}:${infer Param}`
      ? Param
      : never

/**
 * The action's route in the public HTTP API, relative to `/api/v1`. Each
 * `:name` segment fills the string input field of the same name. A GET takes
 * the rest of its input as JSON in `?input=`; other methods take it as the
 * JSON body.
 */
export interface HttpRoute {
  readonly method: HttpMethod
  readonly path: string
}

/**
 * A text field that may come from a local file (the CLI's `--file`). Its
 * content is limited to `maxBytes` UTF-8 bytes on every transport.
 */
export interface FileInput<Field extends string = string> {
  readonly contentField: Field
  readonly filenameField: Field
  readonly maxBytes: number
}

/**
 * One business operation, as every transport sees it: oRPC for the browser,
 * the public HTTP API, the manifest, MCP and the CLI. Frontend-safe; the
 * server pairs each one with its handler in `apps/tools-backend/src/entrypoints/actions`.
 */
export interface ActionSpec<
  A extends App = App,
  I extends InputSchema = InputSchema,
  O extends OutputSchema = OutputSchema,
> {
  readonly _tag: "Action"
  readonly app: A
  /** Written for agents: what the action does and what it returns. */
  readonly description: string
  readonly effect: ActionEffect
  readonly http: HttpRoute
  readonly input: I
  readonly output: O
  readonly file?: FileInput
}

export type AnyActionSpec = ActionSpec

/** Leaves are actions; the path to a leaf is the action's name. */
export interface ActionTree<A extends App = App> {
  readonly [key: string]: ActionSpec<A> | ActionTree<A>
}

type CheckedPath<P extends string, I extends InputSchema> = [
  PathParams<P>,
] extends [StringField<I>]
  ? unknown
  : { readonly "every :param must name a string input field": never }

/**
 * Declares the actions of one app: `const action = actionsFor("flights")`,
 * then `action({ ... })` for each. The route's parameters must be string
 * input fields, and a write cannot be a GET; both are checked by the compiler.
 */
export const actionsFor =
  <A extends App>(app: A) =>
  <
    I extends InputSchema,
    O extends OutputSchema,
    const P extends string,
    E extends ActionEffect,
  >(spec: {
    readonly description: string
    readonly effect: E
    readonly http: {
      readonly method: E extends "write"
        ? Exclude<HttpMethod, "GET">
        : HttpMethod
      readonly path: P
    } & CheckedPath<P, I>
    readonly input: I
    readonly output: O
    readonly file?: FileInput<StringField<I>>
  }): ActionSpec<A, I, O> => ({
    _tag: "Action",
    app,
    description: spec.description,
    effect: spec.effect,
    http: { method: spec.http.method, path: spec.http.path },
    input: spec.input,
    output: spec.output,
    ...(spec.file ? { file: spec.file } : {}),
  })

export const isActionSpec = (
  value: ActionSpec | ActionTree
): value is ActionSpec => value._tag === "Action"
