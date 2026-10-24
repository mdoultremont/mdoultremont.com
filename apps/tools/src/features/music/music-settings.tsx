import { ClassificationPanel } from "@/features/music/classification-panel"
import { DeliveryPanel } from "@/features/music/delivery-panel"
import { DestinationPanel } from "@/features/music/destination-panel"
import { EnrichmentPanel } from "@/features/music/enrichment-panel"
import { SpotifyConnectionPanel } from "@/features/music/spotify-connection-panel"
import { PageHeader } from "@/features/apps/shell"

export function MusicSettings() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your Spotify connection and music automation."
      />
      <SpotifyConnectionPanel>
        <EnrichmentPanel />
        <DestinationPanel />
        <ClassificationPanel />
        <DeliveryPanel />
      </SpotifyConnectionPanel>
    </>
  )
}
