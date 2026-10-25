import { createRoot } from "react-dom/client"
import { IngestionPanel } from "../../../src/features/music/ingestion-panel"
import { InputLibraryProvider } from "../../../src/features/music/input-library"

export function mountSourcesPanel() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  createRoot(element).render(
    <InputLibraryProvider>
      <IngestionPanel />
    </InputLibraryProvider>
  )
}
