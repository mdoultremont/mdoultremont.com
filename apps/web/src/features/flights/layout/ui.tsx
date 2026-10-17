import { useEffect, useState } from "react"
import { Button } from "@/features/ui/button"
import { Skeleton } from "@/features/ui/skeleton"

export const message = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Something went wrong. Please try again."

/** Client-side reads follow the music panels; private API data is never fetched during SSR. */
export function useFlightResource<T>(load: () => Promise<T>) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    data: T | null
    error: string | null
    loading: boolean
  }>({ data: null, error: null, loading: true })
  useEffect(() => {
    let active = true
    setState({ data: null, error: null, loading: true })
    load()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false })
      })
      .catch((cause: unknown) => {
        if (active)
          setState({ data: null, error: message(cause), loading: false })
      })
    return () => {
      active = false
    }
  }, [load, revision])
  return { ...state, reload: () => setRevision((value) => value + 1) }
}

export function LoadState({
  error,
  reload,
  label,
}: {
  error: string | null
  reload: () => void
  label: string
}) {
  return error ? (
    <div className="mt-6">
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
      <Button type="button" variant="outline" className="mt-3" onClick={reload}>
        Try again
      </Button>
    </div>
  ) : (
    <div className="mt-6 space-y-3">
      <output className="block text-sm text-muted-foreground">
        Loading {label}…
      </output>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}
