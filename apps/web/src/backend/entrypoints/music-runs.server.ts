import { env } from "cloudflare:workers"
import { requireCurrentOwner } from "./app-auth.server"
import { musicRunRuntime } from "@/backend/modules/music-run-runtime"

export async function musicRunsHttp(request: Request): Promise<Response> {
  let owner: Awaited<ReturnType<typeof requireCurrentOwner>>
  try {
    owner = await requireCurrentOwner(request)
  } catch {
    return json({ error: "Owner sign-in required" }, 401)
  }
  const runtime = musicRunRuntime(env)
  try {
    if (request.method === "GET")
      return json(await runtime.store.status(owner.id))
    const cookie = request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("music_csrf="))
      ?.slice(11)
    if (
      request.headers.get("Origin") !== new URL(request.url).origin ||
      !cookie ||
      decodeURIComponent(cookie) !== request.headers.get("X-CSRF-Token")
    )
      return json({ error: "Request verification failed" }, 403)
    const body: unknown = await request.json()
    if (typeof body !== "object" || body === null)
      return json({ error: "Invalid run request" }, 400)
    if (
      request.method === "PUT" &&
      "enabled" in body &&
      typeof body.enabled === "boolean"
    ) {
      await runtime.store.setEnabled(owner.id, body.enabled)
      return json(await runtime.store.status(owner.id))
    }
    if (
      request.method === "POST" &&
      "mode" in body &&
      (body.mode === "catchup" ||
        body.mode === "full" ||
        body.mode === "reclassify")
    )
      return json({ run: await runtime.start(owner.id, body.mode) }, 202)
    return json({ error: "Invalid run request" }, 400)
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Run request failed" },
      409
    )
  }
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}
