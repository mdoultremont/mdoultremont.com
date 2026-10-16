import { useEffect, useId, useState } from "react"
import type { App } from "@/server/actions/auth"
import type {
  DirectoryUser,
  PendingInvitationSummary,
  UserDirectory,
} from "@/server/actions/back-office/users"
import { appCatalog, appName } from "@/features/apps/catalog"
import { providerNames } from "@/features/auth/auth-client"

/**
 * Spotify keeps apps in development mode for personal projects: only accounts
 * added by hand in its dashboard may use them, and at most this many.
 */
const spotifyAllowlist = {
  limit: 5,
  dashboardUrl: "https://developer.spotify.com/dashboard",
}

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
    readJson<UserDirectory>("/api/apps/back-office/users")
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
          directory: await readJson<UserDirectory>(
            "/api/apps/back-office/users"
          ),
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

  if (view.kind === "loading")
    return <p className="mt-6 text-sm text-ink/60">Loading users…</p>
  if (view.kind === "error")
    return (
      <p className="mt-6 text-sm text-red-800" role="alert">
        {view.message}
      </p>
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
      {error ? (
        <p className="mt-6 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <output className="mt-6 block text-sm text-ink/70">{notice}</output>
      ) : null}
      {allowlistReminder ? (
        <p className="mt-3 rounded-xl bg-ink/5 p-4 text-sm leading-6 text-ink/80">
          Now add their Spotify account in the <SpotifyDashboardLink /> (your
          app → User Management), with the email of their Spotify account.
          Spotify refuses Music until you do.
        </p>
      ) : null}

      <InviteForm
        busy={busy}
        musicSpots={musicSpots}
        onInvite={(email, apps) =>
          mutate(
            "/api/apps/back-office/invitations",
            "POST",
            { email, apps },
            `Invitation sent to ${email}.`,
            apps.includes("music")
          )
        }
      />

      <section
        className="mt-6 rounded-2xl border border-ink/10 p-5"
        aria-label="Users"
      >
        <h2 className="text-lg font-semibold text-ink">Users</h2>
        <SpotifySpots used={musicSpots} />
        <ul className="mt-4 space-y-3">
          {users.map((user) => (
            <UserRow
              busy={busy}
              isCurrentUser={user.id === currentUserId}
              key={user.id}
              onAccess={(apps) =>
                void mutate(
                  "/api/apps/back-office/users",
                  "PUT",
                  { userId: user.id, apps },
                  undefined,
                  apps.includes("music") && !user.apps.includes("music")
                )
              }
              onRemove={() => {
                if (
                  window.confirm(
                    `Remove ${user.name}? They will be signed out and lose access to every app.`
                  )
                )
                  void mutate(
                    "/api/apps/back-office/users",
                    "DELETE",
                    { userId: user.id },
                    `${user.name} was removed.`
                  )
              }}
              user={user}
            />
          ))}
        </ul>
      </section>

      <section
        className="mt-6 rounded-2xl border border-ink/10 p-5"
        aria-label="Pending invitations"
      >
        <h2 className="text-lg font-semibold text-ink">Pending invitations</h2>
        {invitations.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No pending invitations.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {invitations.map((invitation) => (
              <InvitationRow
                busy={busy}
                invitation={invitation}
                key={invitation.id}
                onResend={() =>
                  void mutate(
                    "/api/apps/back-office/invitations/resend",
                    "POST",
                    { invitationId: invitation.id },
                    `A new link was sent to ${invitation.email}.`
                  )
                }
                onRevoke={() =>
                  void mutate(
                    "/api/apps/back-office/invitations",
                    "DELETE",
                    { invitationId: invitation.id },
                    `The invitation to ${invitation.email} was revoked.`
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function InviteForm({
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
      className="mt-6 rounded-2xl border border-ink/10 p-5"
      onSubmit={(event) => {
        event.preventDefault()
        void onInvite(email, apps).then((sent) => {
          if (sent) setEmail("")
        })
      }}
    >
      <h2 className="text-lg font-semibold text-ink">Invite someone</h2>
      <p className="mt-2 text-sm leading-6 text-ink/70">
        They receive an email with a link to finish signing up with GitHub or
        Spotify. The link works for 7 days.
      </p>
      <label className="mt-4 block text-sm font-medium" htmlFor={emailId}>
        Email
      </label>
      <input
        autoComplete="off"
        className="mt-1 w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
        id={emailId}
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Apps</legend>
        <AppCheckboxes onChange={setApps} selected={apps} />
      </fieldset>
      {apps.includes("music") ? (
        <p className="mt-3 text-sm leading-6 text-ink/70">
          Music uses your Spotify app, which only works for accounts you add by
          hand in the <SpotifyDashboardLink />. Once you send the invitation,
          add their Spotify account there.{" "}
          {musicSpots >= spotifyAllowlist.limit ? (
            <strong className="font-medium text-red-800">
              All {spotifyAllowlist.limit} spots are already taken, so they will
              not be able to use Music.
            </strong>
          ) : null}
        </p>
      ) : null}
      <button
        className="mt-5 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition hover:bg-ink/80 disabled:opacity-50"
        disabled={busy || email.trim() === "" || apps.length === 0}
        type="submit"
      >
        Send invitation
      </button>
    </form>
  )
}

function UserRow({
  user,
  isCurrentUser,
  busy,
  onAccess,
  onRemove,
}: {
  user: DirectoryUser
  isCurrentUser: boolean
  busy: boolean
  onAccess: (apps: ReadonlyArray<App>) => void
  onRemove: () => void
}) {
  return (
    <li className="rounded-xl border border-ink/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">
            {user.name}
            {isCurrentUser ? (
              <span className="ml-2 text-xs font-normal text-ink/50">You</span>
            ) : null}
          </p>
          <p className="text-sm break-all text-ink/60">{user.email}</p>
          <p className="text-xs text-ink/50">
            Signs in with{" "}
            {user.providers
              .map((provider) =>
                provider in providerNames
                  ? providerNames[provider as keyof typeof providerNames]
                  : provider
              )
              .join(", ") || "no account yet"}
          </p>
        </div>
        {isCurrentUser ? null : (
          <button
            className="text-sm underline disabled:opacity-50"
            disabled={busy}
            onClick={onRemove}
            type="button"
          >
            Remove
          </button>
        )}
      </div>
      <AppCheckboxes
        disabled={busy}
        locked={isCurrentUser ? ["backOffice"] : []}
        onChange={onAccess}
        selected={user.apps}
      />
    </li>
  )
}

function InvitationRow({
  invitation,
  busy,
  onResend,
  onRevoke,
}: {
  invitation: PendingInvitationSummary
  busy: boolean
  onResend: () => void
  onRevoke: () => void
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-ink/10 p-4">
      <div className="min-w-0">
        <p className="font-medium break-all">{invitation.email}</p>
        <p className="text-xs text-ink/50">
          {invitation.apps.map(appName).join(", ")} ·{" "}
          {invitation.expired
            ? "Expired"
            : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
        </p>
      </div>
      <div className="flex gap-3 text-sm">
        <button
          className="underline disabled:opacity-50"
          disabled={busy}
          onClick={onResend}
          type="button"
        >
          Send a new link
        </button>
        <button
          className="underline disabled:opacity-50"
          disabled={busy}
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      </div>
    </li>
  )
}

function AppCheckboxes({
  selected,
  onChange,
  disabled = false,
  locked = [],
}: {
  selected: ReadonlyArray<App>
  onChange: (apps: ReadonlyArray<App>) => void
  disabled?: boolean
  /** Apps shown as granted that cannot be unchecked here. */
  locked?: ReadonlyArray<App>
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
      {appCatalog.map((app) => (
        <label className="flex items-center gap-2 text-sm" key={app.id}>
          <input
            checked={selected.includes(app.id)}
            disabled={disabled || locked.includes(app.id)}
            onChange={(event) =>
              onChange(
                appCatalog
                  .map((entry) => entry.id)
                  .filter((id) =>
                    id === app.id ? event.target.checked : selected.includes(id)
                  )
              )
            }
            type="checkbox"
          />
          {app.name}
        </label>
      ))}
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

function SpotifyDashboardLink() {
  return (
    <a
      className="underline underline-offset-4"
      href={spotifyAllowlist.dashboardUrl}
      rel="noreferrer"
      target="_blank"
    >
      Spotify dashboard
    </a>
  )
}

/** How many of the Spotify allowlist's spots Music users and pending invitations take. */
function SpotifySpots({ used }: { used: number }) {
  const over = used > spotifyAllowlist.limit
  return (
    <p
      className={`mt-2 text-sm leading-6 ${over ? "text-red-800" : "text-ink/60"}`}
    >
      Music: {used} of {spotifyAllowlist.limit} Spotify allowlist spots,
      counting pending invitations.
      {over
        ? " Spotify only allows " +
          spotifyAllowlist.limit +
          " accounts in development mode, so some of these people cannot use Music."
        : null}
    </p>
  )
}
