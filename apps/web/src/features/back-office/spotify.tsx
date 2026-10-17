import { cn } from "@/features/ui/lib/utils"

/**
 * Spotify keeps apps in development mode for personal projects: only accounts
 * added by hand in its dashboard may use them, and at most this many.
 */
export const spotifyAllowlist = {
  limit: 5,
  dashboardUrl: "https://developer.spotify.com/dashboard",
}

export function SpotifyDashboardLink() {
  return (
    <a
      className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
      href={spotifyAllowlist.dashboardUrl}
      rel="noreferrer"
      target="_blank"
    >
      Spotify dashboard
    </a>
  )
}

/** How many of the Spotify allowlist's spots Music users and pending invitations take. */
export function SpotifySpots({ used }: { used: number }) {
  const over = used > spotifyAllowlist.limit
  return (
    <p
      className={cn(
        "text-sm leading-6",
        over ? "text-destructive" : "text-muted-foreground"
      )}
    >
      Music: {used} of {spotifyAllowlist.limit} Spotify allowlist spots,
      counting pending invitations.
      {over
        ? " Spotify only allows " +
          spotifyAllowlist.limit +
          " accounts in development mode, so some of these people cannot use Music."
        : null}
    </p>
  )
}
