import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/features/apps/shell"
import { importFlight } from "@/features/flights/api"
import { message } from "@/features/flights/layout/ui"
import { Button } from "@/features/ui/button"
import { Input } from "@/features/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/features/ui/item"
import { cn } from "@/features/ui/lib/utils"
import {
  bookmarkletHref,
  SYRIDE_ORIGINS,
  type SyncMessage,
} from "@/features/flights/syride"

type Result = { key: number; filename: string } & (
  | { status: "imported" | "duplicate"; flightId: string }
  | { status: "pending" | "error"; message: string }
)
export function FlightImport() {
  const input = useRef<HTMLInputElement>(null)
  const nextKey = useRef(0)
  const processing = useRef(false)
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [sync, setSync] = useState<string | null>(null)
  const bookmarklet = useRef<HTMLAnchorElement>(null)
  const replace = (result: Result) =>
    setResults((previous) =>
      previous.map((item) => (item.key === result.key ? result : item))
    )
  const queue = (filename: string, note: string) => {
    const item: Result = {
      key: nextKey.current++,
      filename,
      status: "pending",
      message: note,
    }
    setResults((previous) => [...previous, item])
    return item
  }
  // React refuses `javascript:` URLs in JSX, so the href is replaced here.
  useEffect(() => {
    bookmarklet.current?.setAttribute(
      "href",
      bookmarkletHref(window.location.origin)
    )
  }, [])
  // Opened by the Syride bookmarklet: receive its files and import them one
  // at a time, answering each so it can remember what is already synced.
  useEffect(() => {
    const opener = window.opener as Window | null
    if (
      !opener ||
      new URLSearchParams(window.location.search).get("from") !== "syride"
    )
      return
    setSync("Waiting for Syride…")
    const greet = () =>
      SYRIDE_ORIGINS.forEach((origin) =>
        opener.postMessage({ type: "flights-sync:ready" }, origin)
      )
    greet()
    let greeting: ReturnType<typeof setInterval> | undefined = setInterval(
      greet,
      500
    )
    const stopGreeting = () => {
      clearInterval(greeting)
      greeting = undefined
    }
    let total = 0
    let done = 0
    let chain = Promise.resolve()
    const onMessage = (event: MessageEvent<SyncMessage>) => {
      if (event.source !== opener || !SYRIDE_ORIGINS.includes(event.origin))
        return
      const data = event.data
      const answer = (reply: SyncMessage) =>
        opener.postMessage(reply, event.origin)
      if (data?.type === "flights-sync:start") {
        stopGreeting()
        total = data.total
        setSync(
          total
            ? `Syncing ${total} new ${total === 1 ? "flight" : "flights"} from Syride…`
            : "Syride has no new flights."
        )
      } else if (data?.type === "flights-sync:file") {
        const item = queue(data.filename, "Importing…")
        chain = chain.then(async () => {
          let ok = false
          try {
            const result = await importFlight({
              filename: data.filename,
              text: data.text,
            })
            ok = true
            replace({ ...item, ...result })
          } catch (cause) {
            replace({ ...item, status: "error", message: message(cause) })
          }
          done++
          setSync(`Synced ${done} of ${total} from Syride…`)
          answer({ type: "flights-sync:result", id: data.id, ok })
        })
      } else if (data?.type === "flights-sync:skip") {
        setResults((previous) => [
          ...previous,
          {
            key: nextKey.current++,
            filename: data.filename,
            status: "error",
            message: data.message,
          },
        ])
        done++
      } else if (data?.type === "flights-sync:done") {
        void chain.then(() =>
          setSync(
            total ? "Syride sync finished." : "Syride has no new flights."
          )
        )
      } else if (data?.type === "flights-sync:failed") {
        stopGreeting()
        setSync(`Syride sync failed: ${data.message}`)
      }
    }
    window.addEventListener("message", onMessage)
    return () => {
      stopGreeting()
      window.removeEventListener("message", onMessage)
    }
  }, [])
  async function upload(files: File[]) {
    if (processing.current || files.length === 0) return
    processing.current = true
    setBusy(true)
    const queued: Result[] = files.map((file) => ({
      key: nextKey.current++,
      filename: file.name,
      status: "pending",
      message: "Waiting…",
    }))
    setResults((previous) => [...previous, ...queued])
    try {
      for (const [index, file] of files.entries()) {
        const item = queued[index]!
        try {
          if (!/\.(gpx|igc)$/i.test(file.name))
            throw new Error("Choose a GPX or IGC file.")
          if (file.size > 5_000_000)
            throw new Error(
              "This file is too large. Choose a file under 5 MB (5,000,000 bytes)."
            )
          replace({ ...item, status: "pending", message: "Importing…" })
          const text = await file.text()
          if (new TextEncoder().encode(text).byteLength > 5_000_000)
            throw new Error("The decoded text exceeds the 5 MB limit.")
          replace({
            ...item,
            ...(await importFlight({ filename: file.name, text })),
          })
        } catch (cause) {
          replace({ ...item, status: "error", message: message(cause) })
        }
      }
    } finally {
      processing.current = false
      setBusy(false)
      if (input.current) input.current.value = ""
    }
  }
  return (
    <section>
      <PageHeader
        title="Import flights"
        description="Bring your recorded tracks into your logbook. GPX is preferred; IGC works too."
      />
      <div
        className={cn(
          "rounded-xl border border-dashed p-6 text-center transition-colors sm:p-10",
          dragging ? "border-primary bg-primary/5" : "border-border bg-card"
        )}
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void upload(Array.from(event.dataTransfer.files))
        }}
      >
        <h2 className="font-heading text-lg font-semibold">
          Drop your flight files here
        </h2>
        <p
          id="flight-file-help"
          className="mt-2 text-sm leading-6 text-muted-foreground"
        >
          GPX or IGC · multiple files · up to 5 MB each
        </p>
        <Input
          ref={input}
          aria-label="Flight files"
          aria-describedby="flight-file-help"
          type="file"
          accept=".gpx,.igc"
          multiple
          disabled={busy}
          className="sr-only h-px w-px"
          tabIndex={-1}
          onChange={(event) =>
            void upload(Array.from(event.target.files ?? []))
          }
        />
        <Button
          type="button"
          disabled={busy}
          className="mt-5"
          onClick={() => input.current?.click()}
        >
          {busy ? "Importing files…" : "Choose files"}
        </Button>
      </div>
      <div aria-live="polite" aria-busy={busy}>
        {sync ? <p className="mt-6 text-sm font-medium">{sync}</p> : null}
        {results.length ? (
          <ul className="mt-6 space-y-2">
            {results.map((result) => (
              <Item key={result.key} variant="outline" render={<li />}>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-none break-all">
                    {result.filename}
                  </ItemTitle>
                  <ItemDescription
                    className={cn(
                      "line-clamp-none",
                      result.status === "error" && "text-destructive"
                    )}
                  >
                    {result.status === "imported"
                      ? "Imported successfully"
                      : result.status === "duplicate"
                        ? "Already in your logbook"
                        : "message" in result
                          ? result.message
                          : ""}
                  </ItemDescription>
                </ItemContent>
                {"flightId" in result ? (
                  <ItemActions>
                    <Link
                      className="text-sm underline underline-offset-4"
                      to="/flights/$flightId"
                      params={{ flightId: result.flightId }}
                    >
                      View flight
                    </Link>
                  </ItemActions>
                ) : null}
              </Item>
            ))}
          </ul>
        ) : null}
      </div>
      <section
        className="mt-8 space-y-3 text-sm leading-6 text-muted-foreground"
        aria-labelledby="track-help"
      >
        <h2
          id="track-help"
          className="font-heading text-lg font-semibold text-foreground"
        >
          Getting your tracks
        </h2>
        <p>
          <strong className="font-medium text-foreground">
            Sync from Syride.
          </strong>{" "}
          Drag this button to your bookmarks bar:{" "}
          <a
            ref={bookmarklet}
            href="/flights/import"
            className="rounded-md border bg-card px-2 py-1 font-medium text-foreground no-underline"
          >
            Sync to Flights
          </a>
          . Then, signed in on syride.com, open your profile and click the
          bookmark. It opens this page and imports the IGC files of flights it
          has not synced yet. If Syride shows its security check, pass it and
          the sync continues.
        </p>
        <p>
          From XCTrack, Flyskyhy, or another app, export a GPX track or IGC
          flight file. GPX tracks must include timestamps; planned routes cannot
          be imported.
        </p>
        <p>
          Duplicate files and flights with similar takeoff times link to the
          existing flight. A file below 5 MB may still exceed the compressed
          storage limit; the import will explain if a shorter recording is
          needed.
        </p>
      </section>
    </section>
  )
}
