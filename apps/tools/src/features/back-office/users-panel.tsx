import { CircleAlertIcon, CircleCheckIcon, MailIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { UserDirectory } from "@/server/actions/back-office/users"
import { Alert, AlertDescription } from "@/features/ui/alert"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/features/ui/empty"
import { Skeleton } from "@/features/ui/skeleton"
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

/** Users, their app access, and pending invitations. `currentUserId` is the signed-in user. */
export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const [view, setView] = useState<ViewState>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Set after giving someone Music, which Spotify only allows once they are allowlisted. */
  const [allowlistReminder, setAllowlistReminder] = useState(false)

  useEffect(() => {
    let active = true
    readJson<UserDirectory>("/api/back-office/users")
      .then((directory) => {
        if (active) setView({ kind: "ready", directory })
      })
      .catch((cause: unknown) => {
        if (active) setView({ kind: "error", message: message(cause) })
      })
    return () => {
      active = false
    }
  }, [])

  async function mutate(
    url: string,
    method: "POST" | "PUT" | "DELETE",
    body: unknown,
    done?: string,
    grantsMusic = false
  ) {
    setBusy(true)
    setError(null)
    setNotice(null)
    setAllowlistReminder(false)
    try {
      await readJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (done) setNotice(done)
      setAllowlistReminder(grantsMusic)
      try {
        setView({
          kind: "ready",
          directory: await readJson<UserDirectory>("/api/back-office/users"),
        })
      } catch {
        setError(
          "Saved, but the users could not be reloaded. Refresh this page."
        )
      }
      return true
    } catch (cause) {
      setError(message(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (view.kind === "loading") return <LoadingUsers />
  if (view.kind === "error")
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>{view.message}</AlertDescription>
      </Alert>
    )

  const { users, invitations } = view.directory
  // Pending invitations count too: each will need a spot once accepted.
  const musicSpots =
    users.filter((user) => user.apps.includes("music")).length +
    invitations.filter(
      (invitation) => !invitation.expired && invitation.apps.includes("music")
    ).length

  return (
    <div className="flex flex-col gap-6">
      {error || notice || allowlistReminder ? (
        <div className="flex flex-col gap-3">
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <output className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm text-card-foreground">
              <CircleCheckIcon className="size-4 shrink-0 text-primary" />
              {notice}
            </output>
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

      <section aria-label="Users">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Users</h2>
            </CardTitle>
            <CardDescription>
              <SpotifySpots used={musicSpots} />
            </CardDescription>
            <CardAction>
              <InviteDialog
                busy={busy}
                error={error}
                musicSpots={musicSpots}
                onInvite={(email, apps) =>
                  mutate(
                    "/api/back-office/invitations",
                    "POST",
                    { email, apps },
                    `Invitation sent to ${email}.`,
                    apps.includes("music")
                  )
                }
              />
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Signs in with</TableHead>
                  <TableHead>Apps</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <UserRow
                    busy={busy}
                    isCurrentUser={user.id === currentUserId}
                    key={user.id}
                    onAccess={(apps) =>
                      void mutate(
                        "/api/back-office/users",
                        "PUT",
                        { userId: user.id, apps },
                        undefined,
                        apps.includes("music") && !user.apps.includes("music")
                      )
                    }
                    onRemove={() =>
                      void mutate(
                        "/api/back-office/users",
                        "DELETE",
                        { userId: user.id },
                        `${user.name} was removed.`
                      )
                    }
                    user={user}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Pending invitations">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Pending invitations</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <Empty className="border border-dashed p-6 md:p-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MailIcon />
                  </EmptyMedia>
                  <EmptyDescription>No pending invitations.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Apps</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((invitation) => (
                    <InvitationRow
                      busy={busy}
                      invitation={invitation}
                      key={invitation.id}
                      onResend={() =>
                        void mutate(
                          "/api/back-office/invitations/resend",
                          "POST",
                          { invitationId: invitation.id },
                          `A new link was sent to ${invitation.email}.`
                        )
                      }
                      onRevoke={() =>
                        void mutate(
                          "/api/back-office/invitations",
                          "DELETE",
                          { invitationId: invitation.id },
                          `The invitation to ${invitation.email} was revoked.`
                        )
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function LoadingUsers() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only">Loading users…</p>
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body ? body.error : null
    throw new Error(
      typeof error === "string" ? error : "Users could not be loaded"
    )
  }
  return body as T
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "Users could not be saved"
}
