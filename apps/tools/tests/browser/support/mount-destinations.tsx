import { createRoot } from "react-dom/client"
import { DestinationPanel } from "../../../src/features/music/destination-panel"
import { OutputLibraryProvider } from "../../../src/features/music/output-library"

export function mountDestinationPanel() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  createRoot(element).render(
    <OutputLibraryProvider>
      <DestinationPanel />
    </OutputLibraryProvider>
  )
}
