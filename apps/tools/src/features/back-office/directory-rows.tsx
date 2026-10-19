import {
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import type { App } from "@mdoultremont/tools-contracts/apps"
import type {
  DirectoryUser,
  PendingInvitationSummary,
} from "@mdoultremont/tools-contracts/back-office"
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
} from "@/features/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/features/ui/avatar"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu"
import { cn } from "@/features/ui/lib/utils"
import { TableCell, TableRow } from "@/features/ui/table"
import { EditAccessDialog } from "./edit-access-dialog"

export function UserRow({
  user,
  isCurrentUser,
  busy,
  error,
  onAccess,
  onRemove,
}: {
  user: DirectoryUser
  isCurrentUser: boolean
  busy: boolean
  /** Why the last change failed, for the edit dialog. */
  error: string | null
  onAccess: (apps: ReadonlyArray<App>) => Promise<boolean>
  /** Called once the removal is confirmed. */
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)

  return (
    <TableRow>
      <TableCell className="py-3 pl-5">
        <Person
          avatar={
            <Avatar>
              {user.image ? <AvatarImage alt="" src={user.image} /> : null}
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
          }
          email={user.email}
          name={
            <>
              {user.name}
              {isCurrentUser ? <Badge variant="secondary">You</Badge> : null}
            </>
          }
        />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {appList(user.apps)}
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
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell className="pr-4 text-right">
        <RowMenu busy={busy} label={`Actions for ${user.name}`}>
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit access
          </DropdownMenuItem>
          {isCurrentUser ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRemoving(true)}
                variant="destructive"
              >
                <Trash2Icon />
                Remove
              </DropdownMenuItem>
            </>
          )}
        </RowMenu>
        <EditAccessDialog
          busy={busy}
          error={error}
          locked={isCurrentUser ? ["backOffice"] : []}
          name={user.name}
          onOpenChange={setEditing}
          onSave={onAccess}
          open={editing}
          selected={user.apps}
        />
        <AlertDialog onOpenChange={setRemoving} open={removing}>
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
      </TableCell>
    </TableRow>
  )
}

/** A pending invitation: its apps are fixed, so it can only get a new link or be revoked. */
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
      <TableCell className="py-3 pl-5">
        <Person
          avatar={
            <Avatar>
              <AvatarFallback>
                <MailIcon className="size-4" />
              </AvatarFallback>
            </Avatar>
          }
          email={`Invited ${formatDate(invitation.createdAt)}`}
          name={
            <>
              {invitation.email}
              {invitation.expired ? (
                <StatusDot tone="expired">Expired</StatusDot>
              ) : (
                <StatusDot tone="pending">Pending</StatusDot>
              )}
            </>
          }
        />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {appList(invitation.apps)}
      </TableCell>
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(invitation.expiresAt)}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <RowMenu busy={busy} label={`Actions for ${invitation.email}`}>
          <DropdownMenuItem onClick={onResend}>
            <SendIcon />
            Send a new link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRevoke} variant="destructive">
            <Trash2Icon />
            Revoke
          </DropdownMenuItem>
        </RowMenu>
      </TableCell>
    </TableRow>
  )
}

function Person({
  avatar,
  name,
  email,
}: {
  avatar: ReactNode
  name: ReactNode
  email: string
}) {
  return (
    <div className="flex items-center gap-3">
      {avatar}
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 font-medium">{name}</span>
        <span className="text-muted-foreground">{email}</span>
      </div>
    </div>
  )
}

const statusTones = {
  pending: "bg-amber-500",
  expired: "bg-destructive",
}

/** A coloured dot after an invitation's email; the status is read out, and shown on hover. */
function StatusDot({
  tone,
  children,
}: {
  tone: keyof typeof statusTones
  children: string
}) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", statusTones[tone])}
      title={children}
    >
      <span className="sr-only">{children}</span>
    </span>
  )
}

function RowMenu({
  label,
  busy,
  children,
}: {
  label: string
  busy: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        disabled={busy}
        render={
          <Button
            className="text-muted-foreground"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function appList(apps: ReadonlyArray<App>) {
  return apps.map(appName).join(", ") || "No apps"
}

function formatDate(time: number) {
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}
