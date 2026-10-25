import { createFileRoute } from "@tanstack/react-router"
import { SuggestPage } from "@/features/music/suggest-page"

export const Route = createFileRoute("/_apps/music/output/")({
  component: SuggestPage,
})
