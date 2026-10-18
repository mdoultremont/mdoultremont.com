import { CircleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { UserDirectory } from "@/shared/back-office"
import { api, errorMessage } from "@/features/api"
import { PageHeader } from "@/features/apps/shell"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Skeleton } from "@/features/ui/skeleton"
import { toast } from "@/features/ui/toast"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/features/ui/table"
import { InvitationRow, UserRow } from "./directory-rows"
import { InviteDialog } from "./invite-dialog"
import { SpotifyDashboardLink, SpotifySpots } from "./spotify"

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly directory: UserDirectory }

/** The back office page: users and pending invitations in one table. `currentUserId` is the signed-in user. */
export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const [view, setView] = useState<ViewState>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set after giving someone Music, which Spotify only allows once they are allowlisted. */
  const [allowlistReminder, setAllowlistReminder] = useState(false)

  useEffect(() => {
    let active = true
    api.backOffice.users
      .list()
      .then((directory) => {
        if (active) setView({ kind: "ready", directory })
      })
      .catch((cause: unknown) => {
        if (active)
          setView({
            kind: "error",
            message: errorMessage(cause, "Users could not be loaded"),
          })
      })
    return () => {
      active = false
    }
  }, [])

  async function mutate(
    change: () => Promise<unknown>,
    done?: string,
    grantsMusic = false
  ) {
    setBusy(true)
    setError(null)
    setAllowlistReminder(false)
    try {
      await change()
      if (done) toast(done)
      setAllowlistReminder(grantsMusic)
      try {
        setView({
          kind: "ready",
          directory: await api.backOffice.users.list(),
        })
      } catch {
        setError(
          "Saved, but the users could not be reloaded. Refresh this page."
        )
      }
      return true
    } catch (cause) {
      setError(errorMessage(cause, "Users could not be saved"))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (view.kind === "loading") return <LoadingUsers />
  if (view.kind === "error")
    return (
      <>
        <PageHeader description={description} title={title} />
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{view.message}</AlertDescription>
        </Alert>
      </>
    )

  const { users, invitations } = view.directory
  // Pending invitations count too: each will need a spot once accepted.
  const musicSpots =
    users.filter((user) => user.apps.includes("music")).length +
    invitations.filter(
      (invitation) => !invitation.expired && invitation.apps.includes("music")
    ).length

  return (
    <>
      <PageHeader
        actions={
          <InviteDialog
            busy={busy}
            error={error}
            musicSpots={musicSpots}
            onInvite={(email, apps) =>
              mutate(
                () => api.backOffice.invitations.create({ email, apps }),
                `Invitation sent to ${email}.`,
                apps.includes("music")
              )
            }
          />
        }
        description={description}
        title={title}
      />
      <div className="flex flex-col gap-6">
        {error || allowlistReminder ? (
          <div className="flex flex-col gap-3">
            {error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {allowlistReminder ? (
              <p className="rounded-lg border bg-muted/50 px-3 py-2.5 text-sm leading-6 text-muted-foreground">
                Now add their Spotify account in the <SpotifyDashboardLink />{" "}
                (your app → User Management), with the email of their Spotify
                account. Spotify refuses Music until you do.
              </p>
            ) : null}
          </div>
        ) : null}

        <section
          aria-label="Users and invitations"
          className="flex flex-col gap-3"
        >
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 pl-5 font-normal text-muted-foreground">
                    Person
                  </TableHead>
                  <TableHead className="font-normal text-muted-foreground">
                    Apps
                  </TableHead>
                  <TableHead className="font-normal text-muted-foreground">
                    Signs in with
                  </TableHead>
                  <TableHead className="font-normal text-muted-foreground">
                    Invitation expires
                  </TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <UserRow
                    busy={busy}
                    error={error}
                    isCurrentUser={user.id === currentUserId}
                    key={user.id}
                    onAccess={(apps) =>
                      mutate(
                        () =>
                          api.backOffice.users.setAccess({
                            userId: user.id,
                            apps,
                          }),
                        `${user.name}'s access was saved.`,
                        apps.includes("music") && !user.apps.includes("music")
                      )
                    }
                    onRemove={() =>
                      void mutate(
                        () => api.backOffice.users.remove({ userId: user.id }),
                        `${user.name} was removed.`
                      )
                    }
                    user={user}
                  />
                ))}
                {invitations.map((invitation) => (
                  <InvitationRow
                    busy={busy}
                    invitation={invitation}
                    key={invitation.id}
                    onResend={() =>
                      void mutate(
                        () =>
                          api.backOffice.invitations.resend({
                            invitationId: invitation.id,
                          }),
                        `A new link was sent to ${invitation.email}.`
                      )
                    }
                    onRevoke={() =>
                      void mutate(
                        () =>
                          api.backOffice.invitations.revoke({
                            invitationId: invitation.id,
                          }),
                        `The invitation to ${invitation.email} was revoked.`
                      )
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <SpotifySpots used={musicSpots} />
        </section>
      </div>
    </>
  )
}

const title = "Users"
const description = "Invite people and choose the apps they may use."

function LoadingUsers() {
  return (
    <>
      <PageHeader description={description} title={title} />
      <p className="sr-only">Loading users…</p>
      <Skeleton className="h-80 rounded-xl" />
    </>
  )
}
