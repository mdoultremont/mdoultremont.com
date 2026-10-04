import type { BaselineRun } from "@/backend/workflows/likes-baseline"

export interface BaselineHttpServices {
  readonly owner: (request: Request) => Promise<{ readonly id: string } | null>
  readonly connection: (ownerId: string) => Promise<{
    readonly accountId: string
    readonly needsReconnect: boolean
  } | null>
  readonly latest: (
    ownerId: string,
    accountId: string
  ) => Promise<BaselineRun | null>
  readonly start: (ownerId: string, accountId: string) => Promise<BaselineRun>
  readonly retry: (runId: string) => Promise<BaselineRun | null>
}

export function createLikesBaselineHttp(services: BaselineHttpServices) {
  async function context(request: Request) {
    const owner = await services.owner(request)
    if (!owner) return null
    const connection = await services.connection(owner.id)
    return { owner, connection }
  }

  return {
    async status(request: Request): Promise<Response> {
      const current = await context(request)
      if (!current) return json({ error: "Owner sign-in required" }, 401)
      if (!current.connection) return json({ status: "disconnected" })
      const run = await services.latest(
        current.owner.id,
        current.connection.accountId
      )
      return json(run ? present(run) : { status: "not_started" })
    },
    async start(request: Request): Promise<Response> {
      const current = await context(request)
      if (!current) return json({ error: "Owner sign-in required" }, 401)
      if (!verifiedMutation(request))
        return json({ error: "Request verification failed" }, 403)
      if (!current.connection || current.connection.needsReconnect)
        return json({ error: "Connect Spotify before initialization" }, 409)
      const run = await services.start(
        current.owner.id,
        current.connection.accountId
      )
      return json(present(run), 202)
    },
    async retry(request: Request): Promise<Response> {
      const current = await context(request)
      if (!current) return json({ error: "Owner sign-in required" }, 401)
      if (!verifiedMutation(request))
        return json({ error: "Request verification failed" }, 403)
      if (!current.connection || current.connection.needsReconnect)
        return json({ error: "Reconnect Spotify before retrying" }, 409)
      const run = await services.latest(
        current.owner.id,
        current.connection.accountId
      )
      if (!run) return json({ error: "No initialization run exists" }, 404)
      const resumed = await services.retry(run.id)
      return json(
        resumed
          ? present(resumed)
          : { error: "Initialization run was removed" },
        resumed ? 202 : 404
      )
    },
  }
}

export function present(run: BaselineRun) {
  return {
    runId: run.id,
    status: run.status,
    cutoff: run.cutoff,
    pages: run.pages,
    scanned: run.scanned,
    recorded: run.recorded,
    recent: run.recent,
    total: run.total,
    error: run.error,
    updatedAt: run.updatedAt,
  }
}

function verifiedMutation(request: Request) {
  const csrf = readCookie(request, "music_csrf")
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    Boolean(csrf) &&
    csrf === request.headers.get("X-CSRF-Token")
  )
}

function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=")
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}
