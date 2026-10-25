import { useState } from "react"
import { errorReason } from "@mdoultremont/tools-contracts"
import type {
  DestinationSuggestion,
  DestinationSuggestions,
} from "@mdoultremont/tools-contracts/music"
import { api, errorMessage } from "@/features/api"
import { Button, buttonVariants } from "@/features/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/features/ui/item"
import { Spinner } from "@/features/ui/spinner"

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; reconnect: boolean }
  | {
      kind: "ready"
      result: DestinationSuggestions
      handled: readonly string[]
    }

export function SuggestedPlaylists({ onCreate }: { onCreate: () => void }) {
  const [view, setView] = useState<View>({ kind: "idle" })
  const [creating, setCreating] = useState<string | null>(null)
  const [failure, setFailure] = useState<{
    message: string
    reconnect: boolean
  } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const busy = view.kind === "loading" || creating !== null

  async function suggest() {
    setView({ kind: "loading" })
    setFailure(null)
    setCreated(null)
    try {
      setView({
        kind: "ready",
        result: await api.music.destinations.suggest(),
        handled: [],
      })
    } catch (cause) {
      setView({ kind: "error", ...actionFailure(cause) })
    }
  }

  function dismiss(name: string) {
    setView((current) =>
      current.kind === "ready"
        ? {
            ...current,
            handled: [...current.handled, name],
          }
        : current
    )
  }

  async function create(suggestion: DestinationSuggestion) {
    setCreating(suggestion.name)
    setFailure(null)
    try {
      await api.music.destinations.create({
        name: suggestion.name,
        description: suggestion.description,
        enabled: false,
      })
      dismiss(suggestion.name)
      setCreated(suggestion.name)
      onCreate()
    } catch (cause) {
      setFailure(actionFailure(cause))
    } finally {
      setCreating(null)
    }
  }

  const error = view.kind === "error" ? view : failure
  const remaining =
    view.kind === "ready"
      ? view.result.suggestions.filter(
          (suggestion) => !view.handled.includes(suggestion.name)
        )
      : []
  return (
    <section
      aria-labelledby="suggested-playlists-heading"
      className="space-y-4 rounded-xl border p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="suggested-playlists-heading"
            className="font-heading text-lg font-medium"
          >
            Suggested playlists
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Find new destinations from recording data in your enabled input
            playlists. New destinations start paused.
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={suggest}
          type="button"
          variant="outline"
        >
          {view.kind === "loading" ? <Spinner aria-hidden="true" /> : null}
          {view.kind === "loading"
            ? "Suggesting playlists…"
            : "Suggest playlists"}
        </Button>
      </div>
      {view.kind === "loading" ? (
        <output className="block text-sm text-muted-foreground">
          Looking for sounds and moods your output playlists do not cover…
        </output>
      ) : null}
      {error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
          {error.reconnect ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href="/api/music/spotify/connect"
            >
              Reconnect Spotify
            </a>
          ) : null}
        </div>
      ) : null}
      {created ? (
        <output className="block text-sm">
          Created “{created}” as a paused destination. Enable it in Settings
          when you are ready to receive tracks.
        </output>
      ) : null}
      {view.kind === "ready" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Based on recording analysis for {view.result.analyzedTracks} of{" "}
            {view.result.eligibleTracks} collected tracks in enabled sources.
            Counts are estimates; suggestions are not saved.
          </p>
          {view.result.status === "empty_pool" ? (
            <p className="text-sm">
              Your input pool is empty. Enable a source and read its tracks in
              Input playlists first.
            </p>
          ) : view.result.status === "no_recording_data" ? (
            <p className="text-sm">
              No usable recording analysis yet. Enrich your collected tracks in
              Settings, then try again. Some recordings have no AcousticBrainz
              analysis.
            </p>
          ) : view.result.suggestions.length === 0 ? (
            <p className="text-sm">
              No suggestions to show. Your playlists may already cover these
              groups, or there may not be enough recording data for a new group.
            </p>
          ) : remaining.length === 0 ? (
            <p className="text-sm">
              You have handled every suggestion. Suggest playlists again when
              your input pool changes.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {remaining.map((suggestion) => (
                <Item
                  className="flex-col items-stretch sm:flex-row sm:items-center"
                  key={suggestion.name}
                  render={<li />}
                  variant="outline"
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle>{suggestion.name}</ItemTitle>
                    <p className="text-sm text-muted-foreground">
                      {suggestion.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Estimated fit: {suggestion.estimatedTrackCount} collected
                      tracks
                    </p>
                  </ItemContent>
                  <ItemActions className="flex-wrap">
                    <Button
                      disabled={busy}
                      type="button"
                      onClick={() => create(suggestion)}
                    >
                      {creating === suggestion.name ? (
                        <Spinner aria-hidden="true" />
                      ) : null}
                      {creating === suggestion.name
                        ? "Creating destination…"
                        : "Create destination"}
                    </Button>
                    <Button
                      disabled={busy}
                      type="button"
                      variant="ghost"
                      onClick={() => dismiss(suggestion.name)}
                    >
                      Dismiss
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  )
}

function actionFailure(cause: unknown) {
  return {
    message: errorMessage(
      cause,
      "Playlist suggestions could not be completed. Try again."
    ),
    reconnect: ["NotConnected", "ReconnectNeeded"].includes(
      errorReason(cause) ?? ""
    ),
  }
}
