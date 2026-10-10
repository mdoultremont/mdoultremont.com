import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { currentOwner } from "@/backend/entrypoints/http/auth.server"
import {
  authClient,
  providerNames,
  type SignInProvider,
  signInErrorMessage,
} from "@/components/auth/auth-client"
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
  const [busy, setBusy] = useState(false)
  const error =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("error")

  async function signIn(provider: SignInProvider) {
    setBusy(true)
    const result = await authClient.signIn.social({
      provider,
      callbackURL: "/music",
      errorCallbackURL: "/music",
    })
    if (result.error) setBusy(false)
  }

  async function link(provider: SignInProvider) {
    setBusy(true)
    const result = await authClient.linkSocial({
      provider,
      callbackURL: "/music",
      errorCallbackURL: "/music",
    })
    if (result.error) setBusy(false)
  }

  async function signOut() {
    setBusy(true)
    const result = await authClient.signOut()
    if (result.error) setBusy(false)
    else window.location.assign("/music")
  }

  const unlinked = signInProviders.filter(
    (provider) => owner && !owner.providers.includes(provider)
  )

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
        {error ? (
          <p className="mt-4 text-sm text-red-800" role="alert">
            {signInErrorMessage(error)}
          </p>
        ) : null}
        {owner ? (
          <div className="mt-8">
            <p className="text-base text-ink/75">
              Signed in as{" "}
              <strong className="font-semibold">{owner.name}</strong>.
            </p>
            {unlinked.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {unlinked.map((provider) => (
                  <button
                    className="rounded-full border border-ink/20 px-4 py-2 text-sm disabled:opacity-50"
                    disabled={busy}
                    key={provider}
                    onClick={() => void link(provider)}
                    type="button"
                  >
                    Also sign in with {providerNames[provider]}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="mt-5 rounded-2xl bg-ink/5 p-5 text-sm leading-6 text-ink/70">
              Your private control area is ready. Connect Spotify to configure
              music automation.
            </p>
            <SpotifyConnectionPanel />
            <IngestionPanel />
            <EnrichmentPanel />
            <DestinationPanel />
            <ClassificationPanel />
            <DeliveryPanel />
            <button
              className="mt-8 rounded-full border border-ink/20 px-5 py-3 text-sm font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
              disabled={busy}
              onClick={() => void signOut()}
              type="button"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="mt-8">
            <p className="max-w-prose text-base leading-7 text-ink/70">
              Sign in with one of the owner's accounts to manage private music
              settings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {signInProviders.map((provider) => (
                <button
                  className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-ink/80 disabled:opacity-50"
                  disabled={busy}
                  key={provider}
                  onClick={() => void signIn(provider)}
                  type="button"
                >
                  Continue with {providerNames[provider]}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

const signInProviders: ReadonlyArray<SignInProvider> = ["github", "spotify"]
