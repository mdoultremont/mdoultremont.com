import type { OAuthSite } from "@/server/modules/better-auth"
import type { ActionErrorCode } from "@/shared/actions"

/** What a client asks for to call tools, and to keep doing so without signing in again. */
export const requestedScopes = "tools offline_access"

/**
 * Why a request's credentials were refused. Each transport renders it in its
 * own error body (`errorStatus[code]` is the status) and must send `headers`
 * as they are: they carry the bearer challenge and `Retry-After`.
 */
export interface Refusal {
  readonly _tag: "Refusal"
  readonly code: Extract<
    ActionErrorCode,
    "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "SERVICE_UNAVAILABLE"
  >
  readonly message: string
  readonly headers: Readonly<Record<string, string>>
}

export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "Refusal"

export const refusal = (
  code: Refusal["code"],
  message: string,
  headers: Record<string, string> = {}
): Refusal => ({ _tag: "Refusal", code, message, headers })

/** Why a request's credentials were refused, in RFC 6750 terms. */
export type BearerProblem =
  | { readonly error: "invalid_request"; readonly description: string }
  | { readonly error: "invalid_token"; readonly description: string }
  | { readonly error: "insufficient_scope"; readonly description: string }

const codeOf = {
  invalid_request: "BAD_REQUEST",
  invalid_token: "UNAUTHORIZED",
  insufficient_scope: "FORBIDDEN",
} satisfies Record<BearerProblem["error"], Refusal["code"]>

/**
 * `WWW-Authenticate` for a refused request: RFC 9728 points the client at the
 * protected resource metadata, from which it discovers the authorization
 * server and signs the user in.
 */
export const challengeHeader = (site: OAuthSite, problem?: BearerProblem) =>
  [
    `Bearer resource_metadata="${site.resourceMetadataUrl}"`,
    `scope="${requestedScopes}"`,
    ...(problem === undefined
      ? []
      : [
          `error="${problem.error}"`,
          `error_description="${problem.description}"`,
        ]),
  ].join(", ")

/** A 400, 401 or 403 carrying the challenge. Without a problem, credentials are missing. */
export const challenge = (site: OAuthSite, problem?: BearerProblem) =>
  refusal(
    problem === undefined ? "UNAUTHORIZED" : codeOf[problem.error],
    problem?.description ?? "Sign-in required",
    { "WWW-Authenticate": challengeHeader(site, problem) }
  )
