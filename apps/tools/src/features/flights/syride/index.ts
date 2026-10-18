/**
 * Syride sync: a bookmarklet that runs on syride.com in the user's own signed-in
 * tab, finds their flights, downloads each IGC file and hands it to the import
 * page, which it opens in a second window. Syride has no API, so the bookmarklet
 * reads the same endpoints as Syride's own pages. When Syride asks for its
 * security check, the bookmarklet shows Syride's own check for the user to pass.
 *
 * Messages between the two windows are prefixed with `flights-sync:`.
 */

/* oxlint-disable unicorn/consistent-function-scoping -- `syncFromSyride` is
   serialized into the bookmarklet, so its helpers must stay inside it. */

/** Origins the import page accepts sync messages from. */
export const SYRIDE_ORIGINS = ["https://syride.com", "https://www.syride.com"]

export type SyncMessage =
  | { type: "flights-sync:ready" }
  | { type: "flights-sync:start"; total: number }
  | { type: "flights-sync:file"; id: string; filename: string; text: string }
  | { type: "flights-sync:skip"; id: string; filename: string; message: string }
  | { type: "flights-sync:done" }
  | { type: "flights-sync:failed"; message: string }
  | { type: "flights-sync:result"; id: string; ok: boolean }

/** A `javascript:` URL that runs `syncFromSyride` against this tools origin. */
export const bookmarkletHref = (toolsOrigin: string) =>
  `javascript:(${syncFromSyride.toString()})(${JSON.stringify(toolsOrigin)})`

/**
 * Runs on syride.com. It is serialized into the bookmarklet, so it must stay
 * self-contained: no imports and no references to anything outside its body.
 */
export function syncFromSyride(toolsOrigin: string) {
  if (!/(^|\.)syride\.com$/.test(location.hostname)) {
    alert("Use this bookmark on syride.com.")
    return
  }
  const storageKey = "flights-sync:synced"
  const target = window.open(
    `${toolsOrigin}/flights/import?from=syride`,
    "flights-sync"
  )
  if (!target) {
    alert("Allow pop-ups for Syride, then click the button again.")
    return
  }
  const post = (message: SyncMessage) =>
    target.postMessage(message, toolsOrigin)
  const results = new Map<string, (ok: boolean) => void>()
  let ready: () => void = () => {}
  const readyPromise = new Promise<void>((resolve) => (ready = resolve))
  window.addEventListener("message", (event: MessageEvent<SyncMessage>) => {
    if (event.origin !== toolsOrigin || event.source !== target) return
    if (event.data?.type === "flights-sync:ready") ready()
    if (event.data?.type === "flights-sync:result") {
      results.get(event.data.id)?.(event.data.ok)
      results.delete(event.data.id)
    }
  })

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms))
  /** Fetches with the session cookie, waiting out Syride's rate limit. */
  const request = async (url: string, init?: RequestInit) => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { credentials: "include", ...init })
      if (response.status !== 429 || attempt === 6) return response
      const retryAfter = Number(response.headers.get("Retry-After"))
      await sleep(retryAfter > 0 ? retryAfter * 1000 : attempt * 10_000)
    }
  }
  const text = async (url: string) => {
    const response = await request(url)
    if (!response.ok) throw new Error(`Syride answered ${response.status}`)
    return response.text()
  }
  const synced = new Set<string>(
    JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[]
  )

  /** Syride's own security check, shown on pages that include it. */
  const passCheck = () =>
    new Promise<void>((resolve, reject) => {
      const show = (
        window as unknown as {
          syrideFlightTurnstileShow?: (then: () => void) => void
        }
      ).syrideFlightTurnstileShow
      if (typeof show !== "function")
        return reject(
          new Error(
            "Syride wants a security check. Open your Syride profile and click the button again."
          )
        )
      show(resolve)
    })

  const authorize = async (flight: Flight, retry = true): Promise<void> => {
    const response = await request("/ajax/vols/autoriser-affichage.php", {
      method: "POST",
      body: new URLSearchParams({
        idSession: flight.id,
        expires: flight.expires,
        token: flight.token,
      }),
    })
    if (response.ok) return
    if (retry && response.headers.get("X-Syride-Turnstile-Required") === "1") {
      await passCheck()
      return authorize(flight, false)
    }
    throw new Error(`Syride refused to open this flight (${response.status})`)
  }

  interface Flight {
    readonly id: string
    readonly expires: string
    readonly token: string
  }

  const run = async () => {
    await Promise.race([
      readyPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "The import page did not open. Sign in to tools and try again."
              )
            ),
          120_000
        )
      ),
    ])

    // The signed-in pilot's profile is linked from the account avatar.
    const profile =
      /\/[a-z]{2}\/pilots\/[^"'\s/]+/.exec(
        document.querySelector(".boxRider")?.getAttribute("onclick") ?? ""
      )?.[0] ?? null
    if (!profile) throw new Error("Sign in to Syride first.")
    const riderId = /activites\.php\?limit=[^\n]*?idRider=(\d+)/.exec(
      await text(profile)
    )?.[1]
    if (!riderId) throw new Error("Could not find your Syride flights.")

    const flights: Flight[] = []
    for (let beforeId = 0, page = 0; page < 200; page++) {
      const html = await text(
        `/ajax/pilotes/activites.php?limit=20&l=en&idRider=${riderId}&apli=0` +
          (beforeId ? `&append=1&beforeId=${beforeId}` : "")
      )
      for (const match of html.matchAll(
        /showFlightInPopup\((\d+),\s*(\d+),\s*'([0-9a-f]+)'/g
      ))
        flights.push({ id: match[1]!, expires: match[2]!, token: match[3]! })
      const activities = [...html.matchAll(/id=['"]activite(\d+)['"]/g)]
      if (!activities.length || html.includes("syride-no-more-activity")) break
      beforeId = Number(activities.at(-1)![1])
    }

    const pending = flights.filter((flight) => !synced.has(flight.id))
    post({ type: "flights-sync:start", total: pending.length })
    for (const [index, flight] of pending.entries()) {
      // Stay well under Syride's rate limit.
      if (index > 0) await sleep(1500)
      const filename = `syride-${flight.id}.igc`
      try {
        await authorize(flight)
        const page = await text(
          `/ficheVol.php?l=en&idSession=${flight.id}&maxHeight=600`
        )
        const link = /[^"']*downloadFlightFile\.php\?[^"']*type=igc[^"']*/.exec(
          page
        )?.[0]
        if (!link) throw new Error("Syride has no IGC file for this flight")
        // Links point at www.syride.com; fetch the same path on this origin so
        // the request carries the session cookie.
        const url = new URL(link.replaceAll("&amp;", "&"), location.origin)
        const igc = await text(url.pathname + url.search)
        const ok = await new Promise<boolean>((resolve) => {
          results.set(flight.id, resolve)
          post({
            type: "flights-sync:file",
            id: flight.id,
            filename,
            text: igc,
          })
        })
        if (ok) {
          synced.add(flight.id)
          localStorage.setItem(storageKey, JSON.stringify([...synced]))
        }
      } catch (cause) {
        post({
          type: "flights-sync:skip",
          id: flight.id,
          filename,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    post({ type: "flights-sync:done" })
  }

  run().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    post({ type: "flights-sync:failed", message })
    alert(message)
  })
}
