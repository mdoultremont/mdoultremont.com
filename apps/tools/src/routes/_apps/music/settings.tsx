import { createFileRoute } from "@tanstack/react-router"
import { MusicSettings } from "@/features/music/music-settings"

export const Route = createFileRoute("/_apps/music/settings")({
  component: MusicSettings,
})
