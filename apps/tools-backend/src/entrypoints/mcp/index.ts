import {
  createMcpHandler,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  ProtocolError,
  Server,
  type Tool,
} from "@modelcontextprotocol/server"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject
export type JsonObject = { [key: string]: JsonValue }
export type ObjectJsonSchema = { type: "object"; [key: string]: unknown }

export interface ActionDescriptor {
  readonly name: string
  readonly description: string
  readonly inputSchema: ObjectJsonSchema
  readonly outputSchema: ObjectJsonSchema
  readonly readOnly: boolean
  readonly destructive?: boolean
}

export type ActionResult =
  | { readonly ok: true; readonly value: JsonObject }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }

/** The caller and request-scoped Effect runtime are captured by the authenticated mount. */
export interface ToolsMcpPort {
  readonly list: () => Promise<readonly ActionDescriptor[]>
  readonly invoke: (
    name: string,
    rawInput: Record<string, unknown>
  ) => Promise<ActionResult>
}

export function createToolsMcpHandler(port: ToolsMcpPort) {
  return createMcpHandler(
    () => {
      const server = new Server(
        { name: "mdoultremont-tools", version: "1.0.0" },
        { capabilities: { tools: {} } }
      )
      server.setRequestHandler("tools/list", async () => {
        try {
          const actions = await port.list()
          return {
            tools: actions.map((action): Tool => ({
              name: action.name,
              description: action.description,
              inputSchema: action.inputSchema,
              outputSchema: action.outputSchema,
              annotations: {
                readOnlyHint: action.readOnly,
                destructiveHint: action.destructive ?? !action.readOnly,
              },
            })),
          }
        } catch {
          throw new ProtocolError(INTERNAL_ERROR, "Could not list tools")
        }
      })
      server.setRequestHandler("tools/call", async (request) => {
        try {
          const action = (await port.list()).find(
            (item) => item.name === request.params.name
          )
          if (!action) throw new ProtocolError(INVALID_PARAMS, "Unknown tool")
          const result = await port.invoke(
            action.name,
            request.params.arguments ?? {}
          )
          if (!result.ok) {
            return {
              isError: true,
              structuredContent: { error: result.error },
              content: [
                { type: "text", text: JSON.stringify({ error: result.error }) },
              ],
            }
          }
          return server.projectCallToolResult(
            {
              structuredContent: result.value,
              content: [{ type: "text", text: JSON.stringify(result.value) }],
            },
            action.outputSchema
          )
        } catch (error) {
          if (error instanceof ProtocolError) throw error
          throw new ProtocolError(INTERNAL_ERROR, "Tool invocation failed")
        }
      })
      return server
    },
    { legacy: "stateless" }
  )
}
