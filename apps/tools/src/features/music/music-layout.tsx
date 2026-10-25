import type { ReactNode } from "react"
import { SidebarSlot } from "@/features/apps/shell"
import { useSidebar } from "@/features/ui/sidebar"
import { InputLibraryProvider } from "./input-library"
import { MusicNav } from "./music-nav"
import { MiniPlayer, PlayerProvider } from "./player"

export function MusicLayout({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <InputLibraryProvider>
        <SidebarSlot slot="nav">
          <MusicNav />
        </SidebarSlot>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        <PlayerDock />
      </InputLibraryProvider>
    </PlayerProvider>
  )
}

/** The player lives in the sidebar, or at the bottom of the page while the sidebar is hidden. */
function PlayerDock() {
  const { isMobile, state } = useSidebar()
  if (!isMobile && state === "expanded")
    return (
      <SidebarSlot slot="footer">
        <MiniPlayer variant="sidebar" />
      </SidebarSlot>
    )
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 -mb-12 bg-background/90 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:-mx-8 md:px-8">
      <MiniPlayer variant="bar" />
    </div>
  )
}
