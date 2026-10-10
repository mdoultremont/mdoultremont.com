import { createRoot } from "react-dom/client"
import { DestinationPanel } from "../../../src/components/music/destination-panel"

export function mountDestinationPanel() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  createRoot(element).render(<DestinationPanel />)
}
