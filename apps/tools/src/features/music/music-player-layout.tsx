import type { ReactNode } from "react"
import { PlayerBar, PlayerProvider } from "./player"

export function MusicPlayerLayout({ children }: { children: ReactNode }) {
  return (
    <PlayerProvider>
      <div className="flex min-h-[calc(100svh-7rem)] min-w-0 flex-col gap-6">
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
        <PlayerBar />
      </div>
    </PlayerProvider>
  )
}
