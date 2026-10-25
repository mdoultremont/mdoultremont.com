import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { HeartIcon, ListMusicIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/features/ui/sidebar"
import { AddInputDialog } from "./add-input-dialog"
import { useInputLibrary } from "./input-library"

export const inputPath = (key: string) => `/music/input/${key}`

/** The music app's sidebar section: one link per input playlist, and adding another. */
export function MusicNav() {
  const { library } = useInputLibrary()
  const { setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [adding, setAdding] = useState(false)
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Input playlists</SidebarGroupLabel>
      <SidebarMenu>
        {library.status === "loading"
          ? [0, 1].map((index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            ))
          : null}
        {library.status === "ready"
          ? library.playlists.map((playlist) => {
              const to = inputPath(playlist.key)
              const active = pathname.replace(/\/$/, "") === to
              const Icon =
                playlist.source.sourceId.kind === "liked"
                  ? HeartIcon
                  : ListMusicIcon
              return (
                <SidebarMenuItem key={playlist.key}>
                  <SidebarMenuButton
                    isActive={active}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpenMobile(false)}
                    tooltip={playlist.name}
                    render={<Link to={to} />}
                    className={
                      playlist.source.enabled
                        ? undefined
                        : "text-sidebar-foreground/60"
                    }
                  >
                    <Icon />
                    <span>{playlist.name}</span>
                  </SidebarMenuButton>
                  {playlist.source.enabled ? null : (
                    <SidebarMenuBadge>Paused</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              )
            })
          : null}
        <SidebarMenuItem>
          <SidebarMenuButton
            className="text-sidebar-foreground/70"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            <span>Add input playlist</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <AddInputDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={(playlistId) => {
          setOpenMobile(false)
          void navigate({ to: inputPath(playlistId) })
        }}
      />
    </SidebarGroup>
  )
}
