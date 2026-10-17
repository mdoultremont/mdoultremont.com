import type { App } from "@/server/actions/auth"
import type {
  DirectoryUser,
  PendingInvitationSummary,
} from "@/server/actions/back-office/users"
import { appName } from "@/features/apps/catalog"
import { providerNames } from "@/features/auth/auth-client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/features/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/features/ui/avatar"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/features/ui/item"
import { AppCheckboxes } from "./app-checkboxes"

export function UserRow({
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
  /** Called once the removal is confirmed. */
  onRemove: () => void
}) {
  return (
    <Item className="items-start" render={<li />} variant="outline">
      <ItemMedia>
        <Avatar>
          {user.image ? <AvatarImage alt="" src={user.image} /> : null}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none break-words">
          {user.name}
          {isCurrentUser ? <Badge variant="secondary">You</Badge> : null}
        </ItemTitle>
        <ItemDescription className="break-all">{user.email}</ItemDescription>
        <p className="text-xs text-muted-foreground">
          Signs in with{" "}
          {user.providers
            .map((provider) =>
              provider in providerNames
                ? providerNames[provider as keyof typeof providerNames]
                : provider
            )
            .join(", ") || "no account yet"}
        </p>
      </ItemContent>
      {isCurrentUser ? null : (
        <ItemActions>
          <AlertDialog>
            <AlertDialogTrigger
              disabled={busy}
              render={
                <Button
                  className="text-muted-foreground hover:text-destructive"
                  size="sm"
                  variant="ghost"
                />
              }
            >
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {user.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  They will be signed out and lose access to every app.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onRemove} variant="destructive">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ItemActions>
      )}
      <ItemFooter className="border-t pt-3">
        <AppCheckboxes
          disabled={busy}
          locked={isCurrentUser ? ["backOffice"] : []}
          onChange={onAccess}
          selected={user.apps}
        />
      </ItemFooter>
    </Item>
  )
}

export function InvitationRow({
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
    <Item render={<li />} variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none break-all">
          {invitation.email}
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-2 text-xs">
          {invitation.apps.map(appName).join(", ")}
          {invitation.expired ? (
            <Badge variant="destructive">Expired</Badge>
          ) : (
            <Badge variant="outline">
              Expires {new Date(invitation.expiresAt).toLocaleDateString()}
            </Badge>
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button disabled={busy} onClick={onResend} size="sm" variant="outline">
          Send a new link
        </Button>
        <Button
          className="text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={onRevoke}
          size="sm"
          variant="ghost"
        >
          Revoke
        </Button>
      </ItemActions>
    </Item>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}
