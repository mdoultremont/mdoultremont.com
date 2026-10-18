import { CircleAlertIcon, UserPlusIcon } from "lucide-react"
import { useId, useState } from "react"
import type { App } from "@/shared/apps"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button } from "@/features/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/features/ui/dialog"
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

/** A button that opens the invitation form in a dialog, which closes once the invitation is sent. */
export function InviteDialog({
  busy,
  error,
  musicSpots,
  onInvite,
}: {
  busy: boolean
  /** Why the last change failed, shown in the dialog so it is not hidden behind it. */
  error: string | null
  musicSpots: number
  onInvite: (email: string, apps: ReadonlyArray<App>) => Promise<boolean>
}) {
  const emailId = useId()
  const [open, setOpen] = useState(false)
  /** Whether this opening of the dialog sent an invitation, so older errors stay out of it. */
  const [submitted, setSubmitted] = useState(false)
  const [email, setEmail] = useState("")
  const [apps, setApps] = useState<ReadonlyArray<App>>(["music"])

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setSubmitted(false)
          setEmail("")
          setApps(["music"])
        }
      }}
      open={open}
    >
      <DialogTrigger render={<Button />}>
        <UserPlusIcon data-icon="inline-start" />
        Invite user
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            void onInvite(email, apps).then((sent) => {
              if (sent) setOpen(false)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription className="leading-6">
              They receive an email with a link to finish signing up with GitHub
              or Spotify. The link works for 7 days.
            </DialogDescription>
          </DialogHeader>
          {submitted && error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
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
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={busy || email.trim() === "" || apps.length === 0}
              type="submit"
            >
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
