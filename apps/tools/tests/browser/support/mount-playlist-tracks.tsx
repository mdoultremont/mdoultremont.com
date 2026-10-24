import { createRoot } from "react-dom/client"
import { useState } from "react"
import { PlaylistTracks } from "../../../src/features/music/playlist-tracks"

export function mountPlaylistTracks() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  createRoot(element).render(<Fixture />)
}

function Fixture() {
  const [playlistId, setPlaylistId] = useState("jazz")
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <button type="button" onClick={() => setPlaylistId("other")}>
        Choose other playlist
      </button>
      <PlaylistTracks
        key={playlistId}
        collection={{ kind: "playlist", playlistId }}
        name={playlistId === "jazz" ? "Jazz" : "Other playlist"}
      />
    </div>
  )
}
