import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import {
  HeartIcon,
  InboxIcon,
  ListMusicIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react"
import { useState, type ReactNode } from "react"
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
import { outputPath, useOutputLibrary } from "./output-library"
import type { PlaylistLibrary } from "./playlist-library"

export const inputPath = (key: string) => `/music/input/${key}`

interface NavLink {
  readonly key: string
  readonly to: string
  readonly name: string
  readonly icon: LucideIcon
  readonly paused: boolean
}

/** The music app's sidebar sections: one link per input and output playlist. */
export function MusicNav() {
  const { library: inputs } = useInputLibrary()
  const { library: outputs } = useOutputLibrary()
  const { setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <PlaylistGroup
        label="Input playlists"
        library={inputs}
        link={(playlist) => ({
          key: playlist.key,
          to: inputPath(playlist.key),
          name: playlist.name,
          icon:
            playlist.source.sourceId.kind === "liked"
              ? HeartIcon
              : ListMusicIcon,
          paused: !playlist.source.enabled,
        })}
      >
        <SidebarMenuItem>
          <SidebarMenuButton
            className="text-sidebar-foreground/70"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            <span>Add input playlist</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <AddInputDialog
          open={adding}
          onOpenChange={setAdding}
          onAdded={(playlistId) => {
            setOpenMobile(false)
            void navigate({ to: inputPath(playlistId) })
          }}
        />
      </PlaylistGroup>
      <PlaylistGroup
        label="Output playlists"
        library={outputs}
        link={(playlist) => ({
          key: playlist.playlistId,
          to: outputPath(playlist.playlistId),
          name: playlist.name,
          icon: playlist.role === "review" ? InboxIcon : ListMusicIcon,
          paused: !playlist.enabled,
        })}
      >
        <PageLink
          to="/music/output"
          icon={SparklesIcon}
          name="Suggest playlists"
          className="text-sidebar-foreground/70"
        />
      </PlaylistGroup>
    </>
  )
}

/** Music settings, kept at the bottom of the sidebar beside the player. */
export function MusicSettingsLink() {
  return (
    <SidebarMenu>
      <PageLink
        to="/music/settings"
        icon={SlidersHorizontalIcon}
        name="Settings"
      />
    </SidebarMenu>
  )
}

function PlaylistGroup<Playlist>({
  label,
  library,
  link,
  children,
}: {
  label: string
  library: PlaylistLibrary<Playlist>
  link: (playlist: Playlist) => NavLink
  children: ReactNode
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
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
              const { key, ...entry } = link(playlist)
              return <PageLink key={key} {...entry} />
            })
          : null}
        {children}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function PageLink({
  to,
  name,
  icon: Icon,
  paused = false,
  className,
}: {
  to: string
  name: string
  icon: LucideIcon
  paused?: boolean
  className?: string
}) {
  const { setOpenMobile } = useSidebar()
  const active = useLocation({
    select: (location) => location.pathname.replace(/\/$/, "") === to,
  })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpenMobile(false)}
        tooltip={name}
        render={<Link to={to} />}
        className={paused ? "text-sidebar-foreground/60" : className}
      >
        <Icon />
        <span>{name}</span>
      </SidebarMenuButton>
      {paused ? <SidebarMenuBadge>Paused</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )
}
