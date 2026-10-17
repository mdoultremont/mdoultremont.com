import { ChevronsUpDownIcon, LinkIcon, LogOutIcon } from "lucide-react"
import { useState } from "react"
import {
  authClient,
  providerNames,
  type SignInProvider,
  signInProviders,
} from "@/features/auth/auth-client"
import type { SignedInUser } from "@/server/actions/auth"
import { Avatar, AvatarFallback, AvatarImage } from "@/features/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/features/ui/sidebar"

/** Sidebar footer: who is signed in, linking another sign-in account, and signing out. */
export function NavUser({ user }: { user: SignedInUser }) {
  const { isMobile } = useSidebar()
  const [busy, setBusy] = useState(false)
  const unlinked = signInProviders.filter(
    (provider) => !user.providers.includes(provider)
  )

  async function link(provider: SignInProvider) {
    setBusy(true)
    const here = window.location.pathname
    const result = await authClient.linkSocial({
      provider,
      callbackURL: here,
      errorCallbackURL: here,
    })
    if (result.error) setBusy(false)
  }

  async function signOut() {
    setBusy(true)
    const result = await authClient.signOut()
    if (result.error) setBusy(false)
    else window.location.assign("/apps")
  }

  const identity = (
    <>
      <Avatar>
        {user.image ? <AvatarImage src={user.image} alt="" /> : null}
        <AvatarFallback>{initials(user.name)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {user.email}
        </span>
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
              />
            }
          >
            {identity}
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm text-foreground">
                  {identity}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {unlinked.length > 0 ? (
              <>
                <DropdownMenuGroup>
                  {unlinked.map((provider) => (
                    <DropdownMenuItem
                      key={provider}
                      disabled={busy}
                      onClick={() => void link(provider)}
                    >
                      <LinkIcon />
                      Also sign in with {providerNames[provider]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem disabled={busy} onClick={() => void signOut()}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
