import type { JsonSchema, Schema } from "effect"
import type { ActionRegistry, ActionResult } from "#backend/entrypoints/actions"
import type { App } from "@mdoultremont/tools-contracts/apps"
import type {
  ActionDescriptor as Tool,
  ActionResult as ToolResult,
  JsonObject,
  ObjectJsonSchema,
} from "../../mcp"

/** MCP requires object schemas for tool input and output; an action without one fails at startup. */
const objectSchema = (
  name: string,
  side: "input" | "output",
  schema: JsonSchema.JsonSchema
): ObjectJsonSchema => {
  if (schema.type !== "object")
    throw new Error(`Action ${name} has no object ${side} schema for MCP`)
  return { ...schema, type: "object" }
}

const isJsonObject = (value: Schema.Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The registry's actions as MCP tools: listed per caller from their apps, and
 * each action result as a tool result. Business failures keep their public
 * code and message.
 */
export const mcpTools = (registry: ActionRegistry) => {
  const tools = registry.describe(
    registry.actions.map((entry) => entry.spec.app)
  )
  const all = tools.map((descriptor) => ({
    app: descriptor.app,
    tool: {
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: objectSchema(
        descriptor.name,
        "input",
        descriptor.inputSchema
      ),
      outputSchema: objectSchema(
        descriptor.name,
        "output",
        descriptor.outputSchema
      ),
      readOnly: descriptor.effect === "read",
    } satisfies Tool,
  }))
  return {
    of: (apps: ReadonlyArray<App>): ReadonlyArray<Tool> =>
      all.filter(({ app }) => apps.includes(app)).map(({ tool }) => tool),
    result: (result: ActionResult): ToolResult => {
      if (result._tag === "Failure")
        return {
          ok: false,
          error: { code: result.error.code, message: result.error.message },
        }
      return isJsonObject(result.output)
        ? { ok: true, value: result.output }
        : {
            ok: false,
            error: { code: "INTERNAL_SERVER_ERROR", message: "Request failed" },
          }
    },
  }
}
