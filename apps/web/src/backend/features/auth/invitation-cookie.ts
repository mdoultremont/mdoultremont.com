/**
 * The invitation link stores its token in this cookie before sign-in, so the
 * sign-in gate can find the invitation when the provider redirects back.
 * Scoped to Better Auth's routes, which receive the provider callback.
 */
export const invitationCookie = {
  name: "invitation",
  path: "/api/auth",
  maxAgeSeconds: 60 * 60,
} as const

/** The invitation token from the request's cookies, or `null`. */
export function invitationToken(headers: Headers): string | null {
  for (const part of headers.get("Cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=")
    if (
      separator < 0 ||
      part.slice(0, separator).trim() !== invitationCookie.name
    )
      continue
    const value = part.slice(separator + 1).trim()
    return value === "" ? null : value
  }
  return null
}
