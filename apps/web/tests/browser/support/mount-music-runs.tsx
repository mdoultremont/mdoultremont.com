import { createRoot } from "react-dom/client"
import { MusicRunsPanel } from "../../../src/components/music-runs-panel"

export function mountMusicRuns() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  createRoot(element).render(<MusicRunsPanel csrfToken="test-csrf" />)
}
