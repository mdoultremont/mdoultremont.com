import { type JsonSchema, Schema } from "effect"
import type { App } from "../apps"
import type { CatalogEntry } from "./catalog"
import type { ActionEffect, FileInput, HttpRoute } from "./define"

/**
 * One action as `GET /api/v1` lists it, and as MCP tools and the CLI read it.
 * The JSON Schemas describe the canonical JSON the action accepts and returns.
 */
export interface ActionDescriptor {
  readonly name: string
  readonly app: App
  readonly effect: ActionEffect
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema: JsonSchema.JsonSchema
  /** `path` is relative to /api/v1. */
  readonly http: HttpRoute
  readonly file?: FileInput
}

const isObjectSchema = (schema: unknown) =>
  typeof schema === "object" &&
  schema !== null &&
  "type" in schema &&
  schema.type === "object"

/**
 * A union of object schemas, stated as an object at the root as well: MCP
 * tools and the CLI require `type: "object"` there, and every branch already
 * says it.
 */
const objectRoot = (schema: JsonSchema.JsonSchema): JsonSchema.JsonSchema => {
  const branches = schema.anyOf ?? schema.oneOf
  return schema.type === undefined &&
    Array.isArray(branches) &&
    branches.length > 0 &&
    branches.every(isObjectSchema)
    ? { type: "object", ...schema }
    : schema
}

const jsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  return objectRoot(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions }
  )
}

export const describeAction = ({
  name,
  spec,
}: CatalogEntry): ActionDescriptor => ({
  name,
  app: spec.app,
  effect: spec.effect,
  description: spec.description,
  inputSchema: jsonSchema(spec.input),
  outputSchema: jsonSchema(spec.output),
  http: spec.http,
  ...(spec.file ? { file: spec.file } : {}),
})
