import { createFileRoute } from "@tanstack/react-router"
import { ClassificationPanel } from "@/features/music/classification-panel"
import { DeliveryPanel } from "@/features/music/delivery-panel"
import { DestinationPanel } from "@/features/music/destination-panel"
import { EnrichmentPanel } from "@/features/music/enrichment-panel"
import { IngestionPanel } from "@/features/music/ingestion-panel"
import { SpotifyConnectionPanel } from "@/features/music/spotify-connection-panel"
import { RequireApp } from "@/features/apps/require-app"
import { PageHeader } from "@/features/apps/shell"

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
      <PageHeader
        title="Music control"
        description="Connect Spotify to configure music automation."
      />
      <div className="flex flex-col gap-6">
        <SpotifyConnectionPanel />
        <IngestionPanel />
        <EnrichmentPanel />
        <DestinationPanel />
        <ClassificationPanel />
        <DeliveryPanel />
      </div>
    </RequireApp>
  )
}
