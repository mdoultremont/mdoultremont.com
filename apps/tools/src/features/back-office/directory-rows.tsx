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
import { TableCell, TableRow } from "@/features/ui/table"
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
    <TableRow>
      <TableCell className="py-3">
        <div className="flex items-center gap-3">
          <Avatar>
            {user.image ? <AvatarImage alt="" src={user.image} /> : null}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 font-medium">
              {user.name}
              {isCurrentUser ? <Badge variant="secondary">You</Badge> : null}
            </span>
            <span className="text-muted-foreground">{user.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {user.providers
          .map((provider) =>
            provider in providerNames
              ? providerNames[provider as keyof typeof providerNames]
              : provider
          )
          .join(", ") || "No account yet"}
      </TableCell>
      <TableCell>
        <AppCheckboxes
          disabled={busy}
          locked={isCurrentUser ? ["backOffice"] : []}
          onChange={onAccess}
          selected={user.apps}
        />
      </TableCell>
      <TableCell className="text-right">
        {isCurrentUser ? null : (
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
        )}
      </TableCell>
    </TableRow>
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
    <TableRow>
      <TableCell className="py-3 font-medium">{invitation.email}</TableCell>
      <TableCell className="text-muted-foreground">
        {invitation.apps.map(appName).join(", ")}
      </TableCell>
      <TableCell>
        {invitation.expired ? (
          <Badge variant="destructive">Expired</Badge>
        ) : (
          <Badge variant="outline">
            {new Date(invitation.expiresAt).toLocaleDateString()}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            disabled={busy}
            onClick={onResend}
            size="sm"
            variant="outline"
          >
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
        </div>
      </TableCell>
    </TableRow>
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
