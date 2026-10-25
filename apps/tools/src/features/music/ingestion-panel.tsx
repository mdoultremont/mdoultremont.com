import { CircleAlertIcon, PlusIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import { Checkbox } from "@/features/ui/checkbox"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/features/ui/item"
import { Spinner } from "@/features/ui/spinner"
import { api, errorMessage } from "@/features/api"
import type {
  Ingestion,
  IngestionKind,
  IngestionStatus,
  Source,
  SpotifyPlaylist,
} from "@mdoultremont/tools-contracts/music"
import { AddInputDialog } from "./add-input-dialog"
import { useInputLibrary } from "./input-library"

const pollMilliseconds = 3000

export function IngestionPanel({
  initialStatus,
}: {
  readonly initialStatus?: IngestionStatus
}) {
  const controlId = useId()
  const { revision, reload } = useInputLibrary()
  const [adding, setAdding] = useState(false)
  const [sources, setSources] = useState<readonly Source[] | null>(
    initialStatus?.sources ?? null
  )
  const [playlists, setPlaylists] = useState<readonly SpotifyPlaylist[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inProgress =
    sources?.some(
      (source) =>
        source.latest?.status === "queued" ||
        source.latest?.status === "running"
    ) ?? false
  const runIds =
    sources?.map((source) => source.latest?.id ?? "").join(",") ?? ""

  useEffect(() => {
    let active = true
    api.music.spotify
      .playlists()
      .then((list) => {
        if (active) setPlaylists(list.items)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            errorMessage(
              cause,
              "Spotify playlists could not be loaded. Refresh this page to try again."
            )
          )
      })
    return () => {
      active = false
    }
  }, [revision])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const next = await api.music.sources.get()
        if (!active) return
        setSources(next.sources)
        if (
          next.sources.some(
            (source) =>
              source.latest?.status === "queued" ||
              source.latest?.status === "running"
          )
        )
          timer = setTimeout(load, pollMilliseconds)
      } catch (cause) {
        if (active)
          setError(
            errorMessage(
              cause,
              "Sources could not be loaded. Refresh this page to try again."
            )
          )
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [runIds, inProgress, revision])

  async function mutate(change: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await change()
      reload()
      try {
        const next = await api.music.sources.get()
        setSources(next.sources)
      } catch {
        setError(
          "Saved, but the latest sources could not be loaded. Refresh this page to check them."
        )
      }
      return true
    } catch (cause) {
      setError(errorMessage(cause, "Sources could not be saved"))
      return false
    } finally {
      setBusy(false)
    }
  }

  const names = new Map(
    playlists.map((playlist) => [playlist.id, playlist.name])
  )
  const canRead = sources?.some((source) => source.enabled) ?? false
  const start = (kind: IngestionKind) =>
    mutate(() => api.music.ingestion.start({ kind }))

  return (
    <section aria-label="Input playlists" id="input-playlists">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Input playlists</h2>
          </CardTitle>
          <CardDescription>
            Where tracks come from. Enabled playlists are checked every hour and
            read in full once a day. They are never changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {sources === null && !error ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden="true" />
              Loading sources…
            </p>
          ) : null}
          {sources ? (
            <ul className="flex flex-col gap-3">
              {sources.map((source) => {
                const id = source.sourceId
                const key = id.kind === "liked" ? id.kind : id.playlistId
                const name =
                  id.kind === "liked"
                    ? "Liked Songs"
                    : (names.get(id.playlistId) ?? id.playlistId)
                return (
                  <Item key={key} render={<li />} variant="outline">
                    <ItemContent className="basis-full sm:basis-0">
                      <ItemTitle>{name}</ItemTitle>
                      <p className="text-muted-foreground">
                        {source.enabled ? "In use" : "Paused"}
                      </p>
                    </ItemContent>
                    <ItemActions className="flex-wrap">
                      <Badge variant="secondary">
                        {source.present} present
                        {source.removed > 0
                          ? ` · ${source.removed} removed`
                          : ""}
                      </Badge>
                      <label
                        htmlFor={`${controlId}-${key}`}
                        className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm"
                      >
                        <Checkbox
                          id={`${controlId}-${key}`}
                          aria-label={`Use ${name} as a source`}
                          checked={source.enabled}
                          disabled={busy}
                          onCheckedChange={(enabled) => {
                            void mutate(() =>
                              api.music.sources.setEnabled({
                                sourceId: id,
                                enabled,
                              })
                            )
                          }}
                        />
                        Enabled
                      </label>
                      {id.kind === "playlist" ? (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void mutate(() =>
                              api.music.sources.remove({
                                playlistId: id.playlistId,
                              })
                            )
                          }
                          size="sm"
                          type="button"
                          variant="destructive"
                        >
                          Remove
                        </Button>
                      ) : null}
                    </ItemActions>
                    <div className="basis-full text-muted-foreground">
                      {source.latest ? (
                        <output className="block">
                          {describe(source.latest)}
                        </output>
                      ) : (
                        <p>No tracks read yet.</p>
                      )}
                      {source.latest?.status === "failed" &&
                      source.latest.error ? (
                        <p>{source.latest.error}</p>
                      ) : null}
                    </div>
                  </Item>
                )
              })}
            </ul>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => setAdding(true)}
              type="button"
            >
              <PlusIcon aria-hidden="true" />
              Add input playlist
            </Button>
            <Button
              disabled={busy || inProgress || !canRead}
              onClick={() => void start("incremental")}
              type="button"
              variant="outline"
            >
              Check for new
            </Button>
            <Button
              disabled={busy || inProgress || !canRead}
              onClick={() => void start("full")}
              type="button"
              variant="outline"
            >
              Read everything again
            </Button>
          </div>
        </CardContent>
      </Card>
      <AddInputDialog open={adding} onOpenChange={setAdding} />
    </section>
  )
}

function describe(ingestion: Ingestion) {
  const scope = ingestion.kind === "full" ? "all tracks" : "changes"
  const progress =
    ingestion.total === null
      ? `${ingestion.seen} tracks read`
      : `${ingestion.seen} of ${ingestion.total} tracks read`
  switch (ingestion.status) {
    case "queued":
      return `Waiting to read ${scope}…`
    case "running":
      return `Reading ${scope}: ${progress}…`
    case "completed":
      return [
        ingestion.source.kind === "playlist" && ingestion.pages === 0
          ? `No changes ${formatTime(ingestion.finishedAt)}`
          : `Read ${scope} ${formatTime(ingestion.finishedAt)}`,
        `${ingestion.added} new`,
        ...(ingestion.removed > 0 ? [`${ingestion.removed} removed`] : []),
      ].join(" · ")
    case "failed":
      return `Reading ${scope} stopped after ${progress}.`
  }
}

function formatTime(timestamp: number | null) {
  return timestamp === null
    ? ""
    : `on ${new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
}
