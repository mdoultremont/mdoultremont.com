import { type ApiOptions, createApi } from "../hono"
import { handleOAuthRequest } from "../oauth"

type Fetch = (request: Request) => Response | Promise<Response>

/**
 * Every request of the tools Worker, in order:
 *
 * 1. OAuth discovery under `/.well-known/` and the provider's public
 *    endpoints (`handleOAuthRequest`).
 * 2. `/api/*`: the Hono API (oRPC, `/api/v1`, `/api/mcp`, file downloads).
 *    What it does not match, such as Better Auth under `/api/auth`, falls
 *    through to `fallback`.
 * 3. Everything else: `fallback`, the TanStack app.
 */
export const createToolsFetch = (fallback: Fetch, options?: ApiOptions) => {
  const api = createApi(fallback, options)
  return async (request: Request): Promise<Response> =>
    (await handleOAuthRequest(request)) ??
    (new URL(request.url).pathname.startsWith("/api/")
      ? api.fetch(request)
      : fallback(request))
}
