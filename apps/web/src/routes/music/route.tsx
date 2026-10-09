import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { currentOwner } from "@/backend/entrypoints/http/auth.server"
import { ClassificationPanel } from "@/components/music/classification-panel"
import { DeliveryPanel } from "@/components/music/delivery-panel"
import { DestinationPanel } from "@/components/music/destination-panel"
import { EnrichmentPanel } from "@/components/music/enrichment-panel"
import { IngestionPanel } from "@/components/music/ingestion-panel"
import { SpotifyConnectionPanel } from "@/components/music/spotify-connection-panel"

const loadCurrentOwner = createServerFn({ method: "GET" }).handler(() =>
  currentOwner(getRequest())
)

export const Route = createFileRoute("/music")({
  loader: () => loadCurrentOwner(),
  head: () => ({
    meta: [
      { title: "Private music control · Matthieu d'Oultremont" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MusicControlPage,
})

function MusicControlPage() {
  const owner = Route.useLoaderData()
  const [signingOut, setSigningOut] = useState(false)
  const message =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("signIn")

  async function signOut() {
    if (!owner || signingOut) return
    setSigningOut(true)
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": owner.csrfToken },
    })
    if (response.ok) window.location.assign("/music")
    else setSigningOut(false)
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-16 md:px-10">
      <a className="text-sm text-ink/60 underline underline-offset-4" href="/">
        Return to portfolio
      </a>
      <section className="mt-16 rounded-3xl border border-ink/10 bg-white/60 p-8 shadow-sm md:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/50">
          Private area
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          Music control
        </h1>
        {owner ? (
          <div className="mt-8">
            <p className="text-base text-ink/75">
              Signed in as{" "}
              <strong className="font-semibold">@{owner.identity.login}</strong>
              .
            </p>
            <p className="mt-5 rounded-2xl bg-ink/5 p-5 text-sm leading-6 text-ink/70">
              Your private control area is ready. Connect Spotify to configure
              music automation.
            </p>
            <SpotifyConnectionPanel csrfToken={owner.csrfToken} />
            <IngestionPanel csrfToken={owner.csrfToken} />
            <EnrichmentPanel csrfToken={owner.csrfToken} />
            <DestinationPanel csrfToken={owner.csrfToken} />
            <ClassificationPanel csrfToken={owner.csrfToken} />
            <DeliveryPanel csrfToken={owner.csrfToken} />
            <button
              className="mt-8 rounded-full border border-ink/20 px-5 py-3 text-sm font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
              disabled={signingOut}
              onClick={signOut}
              type="button"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          <div className="mt-8">
            <p className="max-w-prose text-base leading-7 text-ink/70">
              Sign in with the configured GitHub account to manage private music
              settings.
            </p>
            {message === "denied" ? (
              <p className="mt-4 text-sm text-red-800" role="alert">
                This GitHub account is not allowed to use the private music
                area.
              </p>
            ) : message === "failed" ? (
              <p className="mt-4 text-sm text-red-800" role="alert">
                GitHub sign-in could not be completed. Please try again.
              </p>
            ) : null}
            <a
              className="mt-8 inline-flex rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-ink/80"
              href="/api/auth/github"
            >
              Continue with GitHub
            </a>
          </div>
        )}
      </section>
    </main>
  )
}
