import { useId, useState } from "react"
import type { App } from "@/server/actions/auth"
import { Button } from "@/features/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/features/ui/field"
import { Input } from "@/features/ui/input"
import { AppCheckboxes } from "./app-checkboxes"
import { SpotifyDashboardLink, spotifyAllowlist } from "./spotify"

export function InviteForm({
  busy,
  musicSpots,
  onInvite,
}: {
  busy: boolean
  musicSpots: number
  onInvite: (email: string, apps: ReadonlyArray<App>) => Promise<boolean>
}) {
  const emailId = useId()
  const [email, setEmail] = useState("")
  const [apps, setApps] = useState<ReadonlyArray<App>>(["music"])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void onInvite(email, apps).then((sent) => {
          if (sent) setEmail("")
        })
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invite someone</h2>
          </CardTitle>
          <CardDescription className="leading-6">
            They receive an email with a link to finish signing up with GitHub
            or Spotify. The link works for 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                autoComplete="off"
                id={emailId}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Apps</FieldLegend>
              <AppCheckboxes onChange={setApps} selected={apps} />
              {apps.includes("music") ? (
                <FieldDescription className="leading-6">
                  Music uses your Spotify app, which only works for accounts you
                  add by hand in the <SpotifyDashboardLink />. Once you send the
                  invitation, add their Spotify account there.{" "}
                  {musicSpots >= spotifyAllowlist.limit ? (
                    <strong className="font-medium text-destructive">
                      All {spotifyAllowlist.limit} spots are already taken, so
                      they will not be able to use Music.
                    </strong>
                  ) : null}
                </FieldDescription>
              ) : null}
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={busy || email.trim() === "" || apps.length === 0}
            type="submit"
          >
            Send invitation
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
