import type { TrackPreview as Preview } from "@mdoultremont/tools-contracts/flights"

export function TrackPreview({
  preview,
  needsPreparation,
}: {
  preview: Preview | null
  needsPreparation: boolean
}) {
  const first = preview?.[0]
  const last = preview?.at(-1)
  return (
    <figure className="flex w-24 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/50 p-2 sm:w-28">
      {first && last ? (
        <svg
          viewBox="0 0 100 100"
          className="h-16 w-full text-primary"
          aria-hidden="true"
        >
          <polyline
            points={preview!.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={first.x} cy={first.y} r={3} fill="currentColor" />
          {last.i !== first.i ? (
            <circle
              cx={last.x}
              cy={last.y}
              r={3}
              fill="var(--background)"
              stroke="currentColor"
              strokeWidth={2}
            />
          ) : null}
        </svg>
      ) : (
        <span className="flex h-16 items-center text-xs text-muted-foreground">
          {needsPreparation ? "Not prepared" : "No track"}
        </span>
      )}
      <figcaption className="mt-1 text-[10px] text-muted-foreground">
        Track preview
      </figcaption>
    </figure>
  )
}
