# MCP adapter

`createToolsMcpHandler(port)` returns the official SDK's Web-standard handler.
`/api/mcp` in `entrypoints/http/hono` builds it per request, after bearer
authentication and the Origin check, with a port that captures that request's
caller and platform. This adapter does not authenticate, hold sessions, or
import the action registry.

```ts
interface ToolsMcpPort {
  list(): Promise<readonly ActionDescriptor[]>
  invoke(name: string, rawInput: Record<string, unknown>): Promise<ActionResult>
}
```

`ActionDescriptor` contains `name`, `description`, object-root `inputSchema` and
`outputSchema`, `readOnly`, and optional `destructive`. The registry owns the
Effect-to-JSON-Schema projection (`hono/mcp-tools.ts` checks that both are
objects). `invoke` owns access checks, input decoding, business execution,
output encoding, and public errors.

`ActionResult` is `{ ok: true, value: JsonObject }` or
`{ ok: false, error: { code: string, message: string } }`. Business errors
become `isError: true` with structured and text content. Tools the caller's
apps do not include, and unknown names, are Invalid Params ("Unknown tool").
Unexpected failures use a sanitized Internal Error. Tools are listed again on
every list or call.

The dependency is pinned to `@modelcontextprotocol/server@2.3.1`. The low-level
`Server` accepts the projected JSON Schemas without reauthoring business schemas.
`createMcpHandler` supplies request-scoped transport lifecycle and
`legacy: "stateless"`; `projectCallToolResult` supplies SDK wire projection.
`index.test.ts` drives the adapter with the real SDK client on 2025-03-26,
2025-11-25 and 2026-07-28. `entrypoints/http/api/api.test.ts` drives the whole
Worker with the SDK's own OAuth flow on 2025-11-25 and 2026-07-28.

Primary references:
[protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions),
[HTTP handler](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/createMcpHandler.html).
