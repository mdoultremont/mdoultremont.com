import { Link } from "@tanstack/react-router"
import { useRef, useState } from "react"
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
    const replace = (result: Result) =>
      setResults((previous) =>
        previous.map((item) => (item.key === result.key ? result : item))
      )
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
            Syride has no public API.
          </strong>{" "}
          Connect your instrument to SYS PC Tool, choose “Download recorded
          flights”, then export as IGC or GPX.
        </p>
        <p>
          From XCTrack, Flyskyhy, or another app, export a GPX track or IGC
          flight file. GPX tracks must include timestamps; planned routes cannot
          be imported.
        </p>
        <p>
          Imports are manual. Duplicate files and flights with similar takeoff
          times link to the existing flight. A file below 5 MB may still exceed
          the compressed storage limit; the import will explain if a shorter
          recording is needed.
        </p>
      </section>
    </section>
  )
}
