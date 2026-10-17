import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { currentUser } from "@/server/entrypoints/http/auth.server"
import {
  authClient,
  providerNames,
  type SignInProvider,
  signInErrorMessage,
} from "@/features/auth/auth-client"

const loadCurrentUser = createServerFn({ method: "GET" }).handler(() =>
  currentUser(getRequest())
)

/** Every private app lives under /apps; this layout signs the user in once for all of them. */
export const Route = createFileRoute("/apps")({
  loader: () => loadCurrentUser(),
  head: () => ({
    meta: [
      { title: "Apps · Matthieu d'Oultremont" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AppsLayout,
})

function AppsLayout() {
  const user = Route.useLoaderData()
  const [busy, setBusy] = useState(false)
  const search =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search)
  const error = search?.get("error") ?? null
  const invited = search?.get("invited") === "1"

  async function signIn(provider: SignInProvider) {
    setBusy(true)
    const result = await authClient.signIn.social({
      provider,
      callbackURL: here(),
      errorCallbackURL: here(),
    })
    if (result.error) setBusy(false)
  }

  async function link(provider: SignInProvider) {
    setBusy(true)
    const result = await authClient.linkSocial({
      provider,
      callbackURL: here(),
      errorCallbackURL: here(),
    })
    if (result.error) setBusy(false)
  }

  async function signOut() {
    setBusy(true)
    const result = await authClient.signOut()
    if (result.error) setBusy(false)
    else window.location.assign("/apps")
  }

  const unlinked = signInProviders.filter(
    (provider) => user && !user.providers.includes(provider)
  )

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-16 md:px-10">
      <nav className="flex items-center justify-between gap-4 text-sm text-ink/60">
        <a className="underline underline-offset-4" href="/">
          Return to portfolio
        </a>
        {user ? (
          <Link className="underline underline-offset-4" to="/apps">
            All apps
          </Link>
        ) : null}
      </nav>
      <section className="mt-16 rounded-3xl border border-ink/10 bg-white/60 p-8 shadow-sm md:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/50">
          Private area
        </p>
        {error ? (
          <p className="mt-4 text-sm text-red-800" role="alert">
            {signInErrorMessage(error)}
          </p>
        ) : null}
        {user ? (
          <>
            <Outlet />
            <div className="mt-10 border-t border-ink/10 pt-6">
              <p className="text-sm text-ink/70">
                Signed in as{" "}
                <strong className="font-semibold">{user.name}</strong>.
              </p>
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
                <button
                  className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void signOut()}
                  type="button"
                >
                  Sign out
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">
              {invited ? "Finish signing up" : "Sign in"}
            </h1>
            <p className="mt-8 max-w-prose text-base leading-7 text-ink/70">
              {invited
                ? "Continue with GitHub or Spotify to accept your invitation. You will sign in with that account from now on."
                : "Sign in with an account you have used here before. New users need an invitation."}
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

/** Return to the app the user started from. */
const here = () => window.location.pathname
