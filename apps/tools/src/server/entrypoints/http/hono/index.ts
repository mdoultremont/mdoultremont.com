import { env } from "cloudflare:workers"
import {
  type AnyProcedure,
  type AnyRouter,
  isProcedure,
  ORPCError,
  os,
} from "@orpc/server"
import { RPCHandler } from "@orpc/server/fetch"
import { Result, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { createMiddleware } from "hono/factory"
import {
  type ActionError,
  type ActionRegistry,
  actionRegistry,
  type Caller,
  invoke,
  invokeAction,
  type PlatformLayer,
  type RegisteredAction,
} from "@/server/entrypoints/actions"
import {
  type ActionErrorBody,
  type ActionErrorCode,
  errorStatus,
} from "@/shared/actions"
import { FilePayloadSchema } from "@/shared/flights"
import { createToolsMcpHandler } from "../../mcp"
import { platformLayer } from "../../platform"
import {
  authenticate as authenticateWithOAuth,
  type Credentials,
  isRefusal,
  type Refusal,
} from "../oauth"
import { mcpTools } from "./mcp-tools"

/** Cap on any API request body, including JSON escaping and metadata. */
const maxBodyBytes = 6_000_000

type Variables = { caller: Caller; platform: PlatformLayer }
export type ApiApp = Hono<{ Variables: Variables }>

/**
 * Who sends a request, given the credentials its transport accepts: a caller
 * built with the user's current app access, or why the request is refused.
 */
export type Authenticate = (
  request: Request,
  credentials: Credentials
) => Promise<Caller | Refusal>

export interface ApiOptions {
  /** Defaults to OAuth bearer tokens and the session cookie (`entrypoints/http/oauth`). */
  readonly authenticate?: Authenticate
  /** Defaults to every production action. */
  readonly registry?: ActionRegistry
  /** The request's platform layer. Defaults to the Worker's bindings. */
  readonly platform?: () => PlatformLayer
}

const noStore = { "Cache-Control": "no-store" }

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: noStore })

/** How a failure leaves the API: oRPC clients and HTTP clients read different bodies. */
type Wire = "rpc" | "json"

const failure = (
  wire: Wire,
  { code, message, data }: Pick<ActionError, "code" | "message" | "data">
) => {
  const status = errorStatus[code]
  if (wire === "rpc")
    return json(
      { json: new ORPCError(code, { message, data, status }).toJSON() },
      status
    )
  const body: ActionErrorBody = {
    error: { code, message, ...(data ? { data } : {}) },
  }
  return json(body, status)
}

const fail = (wire: Wire, code: ActionErrorCode, message: string) =>
  failure(wire, { code, message, data: undefined })

/** A refusal in the wire's error body, keeping its challenge and `Retry-After`. */
const refuse = (wire: Wire, { code, message, headers }: Refusal) => {
  const response = fail(wire, code, message)
  for (const [name, value] of Object.entries(headers))
    response.headers.set(name, value)
  return response
}

/**
 * Authenticates every request and provides its platform layer. Which
 * credentials count, and the Origin a cookie-authenticated change must come
 * from, are `authenticate`'s rules. Bodies are capped at 6 MB.
 */
const guard = (
  wire: Wire,
  credentials: Credentials,
  authenticate: Authenticate,
  platform: () => PlatformLayer
) => [
  bodyLimit({
    maxSize: maxBodyBytes,
    onError: () =>
      fail(
        wire,
        "PAYLOAD_TOO_LARGE",
        "Request exceeds 6 MB; use a file of at most 5 MB with minimal JSON escaping"
      ),
  }),
  createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const caller = await authenticate(c.req.raw, credentials)
    if (isRefusal(caller)) return refuse(wire, caller)
    c.set("caller", caller)
    c.set("platform", platform())
    await next()
  }),
]

interface RpcContext {
  readonly caller: Caller
  readonly platform: PlatformLayer
}

type RpcRouter = { [key: string]: AnyProcedure | RpcRouter }

const procedure = (entry: RegisteredAction) =>
  os.$context<RpcContext>().handler(async ({ input, context }) => {
    const result = await invokeAction(
      entry.action,
      input,
      context.caller,
      context.platform
    )
    if (result._tag === "Success") return result.output
    const { code, message, data } = result.error
    throw new ORPCError(code, { message, data, status: errorStatus[code] })
  })

const insert = (
  node: RpcRouter,
  [key, ...rest]: readonly string[],
  leaf: AnyProcedure
): RpcRouter => {
  if (key === undefined) return node
  const child = node[key]
  return {
    ...node,
    [key]:
      rest.length === 0
        ? leaf
        : insert(
            child === undefined || isProcedure(child) ? {} : child,
            rest,
            leaf
          ),
  }
}

/** The oRPC router of every action, at its catalog path. */
const rpcRouter = (registry: ActionRegistry): AnyRouter =>
  registry.actions.reduce<RpcRouter>(
    (router, entry) => insert(router, entry.path, procedure(entry)),
    {}
  )

const segments = (entry: RegisteredAction) => entry.spec.http.path.split("/")

/** Static segments first, so `/flights/stats` wins over `/flights/:flightId`. */
const bySpecificity = (a: RegisteredAction, b: RegisteredAction) => {
  const [left, right] = [segments(a), segments(b)]
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const leftParam = left[index]?.startsWith(":") ?? false
    const rightParam = right[index]?.startsWith(":") ?? false
    if (leftParam !== rightParam) return leftParam ? 1 : -1
  }
  return right.length - left.length
}

const JsonObject = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
)
const parseObject = Schema.decodeUnknownResult(JsonObject)

/**
 * An action's input from an HTTP request: path parameters, plus the JSON
 * object in `?input=` for a GET or the JSON body otherwise. A field given
 * both ways must have the same value.
 */
const readInput = async (
  request: Request,
  params: Record<string, string>
): Promise<Result.Result<Record<string, unknown>, string>> => {
  const raw =
    request.method === "GET" || request.method === "HEAD"
      ? (new URL(request.url).searchParams.get("input") ?? "")
      : await request.text()
  const parsed = raw.trim() === "" ? Result.succeed({}) : parseObject(raw)
  if (Result.isFailure(parsed))
    return Result.fail(
      request.method === "GET"
        ? "`input` must be a JSON object"
        : "The body must be a JSON object"
    )
  const input: Record<string, unknown> = { ...parsed.success }
  for (const [key, value] of Object.entries(params)) {
    if (key in input && input[key] !== value)
      return Result.fail(`\`${key}\` differs between the path and the input`)
    input[key] = value
  }
  return Result.succeed(input)
}

const attachment = (filename: string) => {
  const fallback = filename.replace(/[^\x20-\x7E]|["\\/]/g, "_") || "download"
  const encoded = Array.from(
    new TextEncoder().encode(filename),
    (byte) => `%${byte.toString(16).padStart(2, "0")}`
  ).join("")
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

const decodeFile = Schema.decodeUnknownSync(
  Schema.toCodecJson(FilePayloadSchema)
)

/**
 * The HTTP shell for everything under /api/. Routes it does not own fall
 * through to `fallback` (the TanStack server routes: Better Auth, the
 * Spotify connection flow, invitation links).
 *
 * - /api/rpc/<action path>: every action over oRPC, for the browser.
 * - /api/v1: the manifest of the caller's actions (`ActionDescriptor`).
 * - /api/v1/<route>: every action at its declared method and path.
 * - /api/flights/files/:fileId: `flights.files.download` as the file itself.
 * - /api/mcp: every action of the caller's apps as an MCP tool, for agents.
 *   Bearer tokens only (see `Credentials`).
 *
 * Every one authenticates with `options.authenticate` and calls the same
 * `invokeAction`.
 */
export function createApi(
  fallback: (request: Request) => Response | Promise<Response>,
  options: ApiOptions = {}
) {
  const authenticate = options.authenticate ?? authenticateWithOAuth
  const registry = options.registry ?? actionRegistry
  const platform = options.platform ?? (() => platformLayer(env))
  const app: ApiApp = new Hono<{ Variables: Variables }>()

  const rpc = new RPCHandler(rpcRouter(registry))
  app.use(
    "/api/rpc/*",
    ...guard("rpc", "bearer-or-session", authenticate, platform)
  )
  app.all("/api/rpc/*", async (c, next) => {
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/api/rpc",
      context: { caller: c.var.caller, platform: c.var.platform },
    })
    if (!matched) return next()
    return response
  })

  for (const prefix of ["/api/v1/*", "/api/flights/files/*"])
    app.use(
      prefix,
      ...guard("json", "bearer-or-session", authenticate, platform)
    )
  app.get("/api/v1", (c) =>
    json({ actions: registry.describe(c.var.caller.apps) })
  )
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy
  for (const entry of [...registry.actions].sort(bySpecificity))
    app.on(
      entry.spec.http.method,
      `/api/v1${entry.spec.http.path}`,
      async (c) => {
        const input = await readInput(c.req.raw, c.req.param())
        if (Result.isFailure(input))
          return fail("json", "BAD_REQUEST", input.failure)
        const result = await invokeAction(
          entry.action,
          input.success,
          c.var.caller,
          c.var.platform
        )
        return result._tag === "Success"
          ? json(result.output)
          : failure("json", result.error)
      }
    )
  app.all("/api/v1/*", () => fail("json", "NOT_FOUND", "No such action route"))

  const download = registry.get("flights.files.download")
  if (download)
    app.get("/api/flights/files/:fileId", async (c) => {
      const result = await invokeAction(
        download.action,
        { fileId: c.req.param("fileId") },
        c.var.caller,
        c.var.platform
      )
      if (result._tag === "Failure") return failure("json", result.error)
      const file = decodeFile(result.output)
      const bytes = new Uint8Array(
        Result.getOrThrow(Base64.decode(file.contentBase64))
      )
      return new Response(bytes, {
        headers: {
          ...noStore,
          "Content-Type": file.contentType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": attachment(file.filename),
          "X-Content-Type-Options": "nosniff",
        },
      })
    })

  const tools = mcpTools(registry)
  app.use("/api/mcp", ...guard("json", "bearer", authenticate, platform))
  app.all("/api/mcp", async (c) => {
    const { caller, platform: layer } = c.var
    const response = await createToolsMcpHandler({
      list: async () => tools.of(caller.apps),
      invoke: async (name, input) =>
        tools.result(await invoke(name, input, caller, layer, registry)),
    }).fetch(c.req.raw)
    const sent = new Response(response.body, response)
    sent.headers.set("Cache-Control", "no-store")
    return sent
  })
  app.notFound((c) => fallback(c.req.raw))
  app.onError((error) => {
    console.error("Unhandled API failure", error)
    return fail("json", "INTERNAL_SERVER_ERROR", "Request failed")
  })
  return app
}
