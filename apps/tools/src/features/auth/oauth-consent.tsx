import { CircleAlertIcon } from "lucide-react"
import { useState } from "react"
import type { ConsentRequest } from "@mdoultremont/tools-contracts/auth"
import { appCatalog } from "@/features/apps/catalog"
import { authClient } from "@/features/auth/auth-client"
import { AuthFrame } from "@/features/auth/auth-frame"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button } from "@/features/ui/button"

/**
 * Asks the signed-in user whether a client may act as them. Allowing hands it
 * everything the user can do in tools, so the page says exactly that.
 */
export function OAuthConsent({
  request,
}: {
  readonly request: ConsentRequest | null
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (request === null)
    return (
      <AuthFrame
        title="This request has expired"
        description="Go back to the app you were connecting and start again."
      >
        {null}
      </AuthFrame>
    )

  const clientName = request.client.name ?? "This app"
  const appNames = appCatalog
    .filter((app) => request.apps.includes(app.id))
    .map((app) => app.name)

  async function answer(accept: boolean) {
    setBusy(true)
    setFailed(false)
    const { data, error } = await authClient.oauth2.consent({ accept })
    if (error || !data?.url) {
      setBusy(false)
      setFailed(true)
      return
    }
    window.location.assign(data.url)
  }

  return (
    <AuthFrame
      title={`Allow ${clientName} to use tools?`}
      description={`Signed in as ${request.user.email}`}
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          {clientName} will be able to do everything you can do in tools,
          including changing and deleting your data
          {appNames.length > 0 ? ` in ${appNames.join(", ")}` : ""}. If you get
          access to more apps later, it gets them too.
        </p>
        <p className="text-muted-foreground">
          It keeps this access until it signs out or you lose access yourself.
          Only allow an app you just asked to connect. Your answer goes back to{" "}
          <span className="font-medium text-foreground">
            {request.redirectOrigin}
          </span>
          .
        </p>
      </div>
      {failed ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>
            Your answer could not be sent. Please try again.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="lg"
          variant="outline"
          disabled={busy}
          onClick={() => void answer(false)}
        >
          Deny
        </Button>
        <Button size="lg" disabled={busy} onClick={() => void answer(true)}>
          Allow
        </Button>
      </div>
    </AuthFrame>
  )
}
