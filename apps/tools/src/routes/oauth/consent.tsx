import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Schema } from "effect"
import { consentRequest } from "@mdoultremont/tools-backend/http"
import { OAuthConsent } from "@/features/auth/oauth-consent"

/**
 * The authorization request behind the page's query, which must reach the
 * server exactly as it signed it: the router's `searchStr` re-serializes
 * repeated keys such as `ba_param` as JSON. In the browser the loader sends
 * `window.location.search`; while rendering on the server, the page request
 * itself carries the query.
 */
const loadConsentRequest = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.NullOr(Schema.String)))
  .handler(({ data }) => {
    const request = getRequest()
    return consentRequest(request, data ?? new URL(request.url).search)
  })

/** Where an OAuth authorization request asks the signed-in user for consent. */
export const Route = createFileRoute("/oauth/consent")({
  loader: () =>
    loadConsentRequest({
      data: typeof window === "undefined" ? null : window.location.search,
    }),
  component: Consent,
})

function Consent() {
  return <OAuthConsent request={Route.useLoaderData()} />
}
