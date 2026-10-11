import { createFileRoute } from "@tanstack/react-router"
import { ClassificationPanel } from "@/components/apps/music/classification-panel"
import { DeliveryPanel } from "@/components/apps/music/delivery-panel"
import { DestinationPanel } from "@/components/apps/music/destination-panel"
import { EnrichmentPanel } from "@/components/apps/music/enrichment-panel"
import { IngestionPanel } from "@/components/apps/music/ingestion-panel"
import { SpotifyConnectionPanel } from "@/components/apps/music/spotify-connection-panel"
import { RequireApp } from "@/components/apps/require-app"

/** Rendered only for signed-in users with music access: the /apps layout signs them in. */
export const Route = createFileRoute("/apps/music")({
  head: () => ({
    meta: [{ title: "Music control · Matthieu d'Oultremont" }],
  }),
  component: MusicControlPage,
})

function MusicControlPage() {
  return (
    <RequireApp app="music">
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">
        Music control
      </h1>
      <p className="mt-5 rounded-2xl bg-ink/5 p-5 text-sm leading-6 text-ink/70">
        Connect Spotify to configure music automation.
      </p>
      <SpotifyConnectionPanel />
      <IngestionPanel />
      <EnrichmentPanel />
      <DestinationPanel />
      <ClassificationPanel />
      <DeliveryPanel />
    </RequireApp>
  )
}
