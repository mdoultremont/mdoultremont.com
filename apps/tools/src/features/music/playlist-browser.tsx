import { ListMusicIcon } from "lucide-react"
import type { SourceId } from "@mdoultremont/tools-contracts/music"
import { Badge } from "@/features/ui/badge"
import { cn } from "@/features/ui/lib/utils"
import { PlaylistTracks } from "./playlist-tracks"

export interface PlaylistEntry {
  readonly collection: SourceId
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  readonly role: "destination" | "review"
}

export const playlistKey = (collection: SourceId) =>
  collection.kind === "liked" ? "liked" : "playlist:" + collection.playlistId

export function PlaylistBrowser({
  entries,
  selected,
  onSelect,
}: {
  entries: readonly PlaylistEntry[]
  selected?: string
  onSelect: (key: string) => void
}) {
  const current =
    selected === undefined
      ? entries[0]
      : entries.find((entry) => playlistKey(entry.collection) === selected)
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Choose playlist" className="min-w-0">
        <ul className="flex flex-col gap-1 rounded-xl border p-2">
          {entries.map((entry) => {
            const key = playlistKey(entry.collection)
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-current={entry === current ? "true" : undefined}
                  onClick={() => onSelect(key)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                    entry === current && "bg-muted"
                  )}
                >
                  <ListMusicIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate font-medium"
                      title={entry.name}
                    >
                      {entry.name}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {entry.role === "review" ? (
                        <Badge variant="outline">Review</Badge>
                      ) : null}
                      {!entry.enabled ? (
                        <Badge variant="secondary">Paused</Badge>
                      ) : null}
                      Output playlist
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      {current ? (
        <div className="min-w-0 space-y-4">
          {current.description ? (
            <p className="text-sm text-muted-foreground">
              {current.description}
            </p>
          ) : null}
          <PlaylistTracks
            key={playlistKey(current.collection)}
            collection={current.collection}
            name={current.name}
          />
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border p-6">
          <h2 className="font-medium">Playlist unavailable</h2>
          <p className="text-sm text-muted-foreground">
            This playlist is no longer configured here. Choose another playlist.
          </p>
        </div>
      )}
    </div>
  )
}
