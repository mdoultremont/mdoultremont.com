import { createActionsClient } from "@/shared/actions/client"

/**
 * Every action, called from the browser over oRPC at /api/rpc with the
 * session cookie. Failures throw `ORPCError` with a readable message. Only
 * called from the browser, never during server rendering.
 */
export const api = createActionsClient({
  url: () => new URL("/api/rpc", window.location.origin).href,
})

/** A failure's message for the page, or `fallback` when it has none. */
export const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback
