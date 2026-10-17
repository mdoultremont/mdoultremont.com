import { CircleAlertIcon } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button } from "@/features/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/features/ui/empty"
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

/** An inline error (`role="alert"`) with a retry button, shared by every Flights page. */
export function ErrorState({
  error,
  reload,
  children,
}: {
  error: string
  reload: () => void
  children?: ReactNode
}) {
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Button type="button" variant="outline" onClick={reload}>
          Try again
        </Button>
        {children}
      </div>
    </div>
  )
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
    <ErrorState error={error} reload={reload} />
  ) : (
    <div className="space-y-3">
      <output className="block text-sm text-muted-foreground">
        Loading {label}…
      </output>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

/** A dashed empty state; `title` stays an `<h2>` so the page outline is unchanged. */
export function EmptyState({
  title,
  description,
  children,
}: {
  title?: ReactNode
  description: ReactNode
  children?: ReactNode
}) {
  return (
    <Empty className="border py-12">
      <EmptyHeader>
        {title ? (
          <EmptyTitle>
            <h2 className="text-lg font-semibold">{title}</h2>
          </EmptyTitle>
        ) : null}
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  )
}
