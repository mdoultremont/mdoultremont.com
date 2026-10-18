import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { describe, expect, it } from "vitest"
import {
  createToolsMcpHandler,
  type ActionDescriptor,
  type ToolsMcpPort,
} from "./index"

const descriptor: ActionDescriptor = {
  name: "tracks.echo",
  description: "Echo a track label",
  inputSchema: { type: "object", properties: { label: { type: "string" } } },
  outputSchema: { type: "object", properties: { label: { type: "string" } } },
  readOnly: true,
}

async function connect(
  port: ToolsMcpPort,
  revision: "2025-03-26" | "2025-11-25" | "2026-07-28"
) {
  const handler = createToolsMcpHandler(port)
  const client = new Client(
    { name: "adapter-test", version: "1" },
    {
      supportedProtocolVersions: [revision],
      versionNegotiation: {
        mode: revision === "2026-07-28" ? { pin: revision } : "legacy",
      },
    }
  )
  const transport = new StreamableHTTPClientTransport(
    new URL("https://tools.test/api/mcp"),
    {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    }
  )
  await client.connect(transport)
  return client
}

describe.each(["2025-03-26", "2025-11-25", "2026-07-28"] as const)(
  "MCP %s",
  (revision) => {
    it("negotiates, lists projected schemas, and invokes with structured and text content", async () => {
      const calls: unknown[] = []
      const client = await connect(
        {
          list: async () => [descriptor],
          invoke: async (name, input) => {
            calls.push({ name, input })
            return { ok: true, value: { label: String(input.label) } }
          },
        },
        revision
      )
      try {
        expect(client.getProtocolEra()).toBe(
          revision.startsWith("2025") ? "legacy" : "modern"
        )
        expect((await client.listTools()).tools).toEqual([
          {
            name: descriptor.name,
            description: descriptor.description,
            inputSchema: descriptor.inputSchema,
            outputSchema: descriptor.outputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
        ])
        const result = await client.callTool({
          name: descriptor.name,
          arguments: { label: "été" },
        })
        expect(result.structuredContent).toEqual({ label: "été" })
        expect(result.content).toEqual([
          { type: "text", text: '{"label":"été"}' },
        ])
        expect(calls).toEqual([
          { name: descriptor.name, input: { label: "été" } },
        ])
      } finally {
        await client.close()
      }
    })

    it("returns business failures as tool errors and unknown tools as protocol errors", async () => {
      const client = await connect(
        {
          list: async () => [descriptor],
          invoke: async () => ({
            ok: false,
            error: { code: "FORBIDDEN", message: "No app access" },
          }),
        },
        revision
      )
      try {
        const result = await client.callTool({ name: descriptor.name })
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toEqual({
          error: { code: "FORBIDDEN", message: "No app access" },
        })
        await expect(
          client.callTool({ name: "missing" })
        ).rejects.toMatchObject({ code: -32602 })
      } finally {
        await client.close()
      }
    })

    it("sanitizes defects and preserves portable binary output", async () => {
      const file = {
        filename: "trace.igc",
        contentType: "application/octet-stream",
        sizeBytes: 3,
        contentBase64: "AP+A",
      }
      const client = await connect(
        {
          list: async () => [descriptor],
          invoke: async (_name, input) => {
            if (input.crash) throw new Error("secret database details")
            return { ok: true, value: file }
          },
        },
        revision
      )
      try {
        expect(
          (await client.callTool({ name: descriptor.name })).structuredContent
        ).toEqual(file)
        await expect(
          client.callTool({ name: descriptor.name, arguments: { crash: true } })
        ).rejects.toMatchObject({ code: -32603 })
      } finally {
        await client.close()
      }
    })
  }
)

it("keeps different authenticated closures isolated and reloads tool availability", async () => {
  let allowed = true
  const client = await connect(
    {
      list: async () => (allowed ? [descriptor] : []),
      invoke: async () => ({ ok: true, value: {} }),
    },
    "2026-07-28"
  )
  const other = await connect(
    {
      list: async () => [],
      invoke: async () => {
        throw new Error("Must not invoke")
      },
    },
    "2026-07-28"
  )
  try {
    expect((await client.listTools()).tools).toHaveLength(1)
    expect((await other.listTools()).tools).toEqual([])
    allowed = false
    expect((await client.listTools()).tools).toEqual([])
    await expect(
      client.callTool({ name: descriptor.name })
    ).rejects.toMatchObject({ code: -32602 })
  } finally {
    await Promise.all([client.close(), other.close()])
  }
})
