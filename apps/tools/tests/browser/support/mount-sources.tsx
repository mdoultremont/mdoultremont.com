import { createRoot } from "react-dom/client"
import { IngestionPanel } from "../../../src/features/music/ingestion-panel"

export function mountSourcesPanel() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  createRoot(element).render(<IngestionPanel />)
}
