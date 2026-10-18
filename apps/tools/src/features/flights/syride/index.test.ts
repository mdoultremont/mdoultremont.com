import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"
import { bookmarkletHref, type SyncMessage } from "."

const toolsOrigin = "https://tools.example"

const flight = (activity: number, id: number) =>
  `<div id='activite${activity}'><a onclick="showFlightInPopup(${id}, 1792326543, 'ab${id}', false);"></a></div>`

/** A fake signed-in Syride tab: two activity pages, three flights. */
function syride(options: { synced?: string[]; rateLimited?: boolean } = {}) {
  const requests: string[] = []
  const sent: SyncMessage[] = []
  const storage = new Map<string, string>()
  if (options.synced)
    storage.set("flights-sync:synced", JSON.stringify(options.synced))
  let limited = options.rateLimited ?? false
  const listeners: ((event: unknown) => void)[] = []
  let finish: (() => void) | undefined
  const finished = new Promise<void>((resolve) => (finish = resolve))
  const pages: Record<string, string> = {
    "/en/pilots/pilot": `var ajaxUrl = '/ajax/pilotes/activites.php?limit='+n+'&l=en&idRider=42&apli=0';`,
    "/ajax/pilotes/activites.php?limit=20&l=en&idRider=42&apli=0":
      flight(30, 3) + flight(20, 2),
    "/ajax/pilotes/activites.php?limit=20&l=en&idRider=42&apli=0&append=1&beforeId=20":
      flight(10, 1) + "<div class='syride-no-more-activity'></div>",
  }
  const target = {
    postMessage(message: SyncMessage, origin: string) {
      expect(origin).toBe(toolsOrigin)
      sent.push(message)
      const reply = (data: SyncMessage) =>
        listeners.forEach((listener) =>
          listener({ origin: toolsOrigin, source: target, data })
        )
      if (message.type === "flights-sync:file")
        setTimeout(() =>
          reply({ type: "flights-sync:result", id: message.id, ok: true })
        )
      if (message.type === "flights-sync:done") finish?.()
    },
  }
  const fetch = async (url: string) => {
    requests.push(url)
    if (limited) {
      limited = false
      return new Response("", { status: 429, headers: { "Retry-After": "1" } })
    }
    if (url === "/ajax/vols/autoriser-affichage.php")
      return Response.json({ success: true })
    const flightPage = /ficheVol\.php\?l=en&idSession=(\d+)/.exec(url)
    if (flightPage)
      return new Response(
        `<a href="https://www.syride.com/scripts/downloadFlightFile.php?idSession=${flightPage[1]}&amp;type=igc&amp;key=k">IGC</a>`
      )
    const file = /downloadFlightFile\.php\?idSession=(\d+)&type=igc/.exec(url)
    if (file) return new Response(`AXSE igc ${file[1]}`)
    const page = pages[url]
    return page === undefined
      ? new Response("", { status: 404 })
      : new Response(page)
  }
  const window = {
    open: (url: string) => {
      expect(url).toBe(`${toolsOrigin}/flights/import?from=syride`)
      setTimeout(() =>
        listeners.forEach((listener) =>
          listener({
            origin: toolsOrigin,
            source: target,
            data: { type: "flights-sync:ready" },
          })
        )
      )
      return target
    },
    addEventListener: (_: string, listener: (event: unknown) => void) =>
      listeners.push(listener),
  }
  const context = {
    window,
    location: { hostname: "syride.com", origin: "https://syride.com" },
    document: {
      querySelector: () => ({
        getAttribute: () => `window.location.href="/en/pilots/pilot";`,
      }),
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    fetch,
    alert: (message: string) => {
      throw new Error(message)
    },
    // Pauses between flights and rate-limit waits are instant in tests.
    setTimeout: (callback: () => void) => setTimeout(callback),
    URL,
    URLSearchParams,
  }
  return {
    run: () => {
      runInNewContext(
        bookmarkletHref(toolsOrigin).slice("javascript:".length),
        context
      )
      return finished
    },
    requests,
    sent,
    synced: () =>
      JSON.parse(storage.get("flights-sync:synced") ?? "[]") as string[],
  }
}

test("sends every flight's IGC file to the import page, newest first", async () => {
  const tab = syride()
  await tab.run()
  expect(tab.sent).toEqual([
    { type: "flights-sync:start", total: 3 },
    ...[3, 2, 1].map((id) => ({
      type: "flights-sync:file",
      id: String(id),
      filename: `syride-${id}.igc`,
      text: `AXSE igc ${id}`,
    })),
    { type: "flights-sync:done" },
  ])
  expect(tab.synced()).toEqual(["3", "2", "1"])
})

test("skips flights it has already synced", async () => {
  const tab = syride({ synced: ["3", "1"] })
  await tab.run()
  expect(tab.sent.map((message) => message.type)).toEqual([
    "flights-sync:start",
    "flights-sync:file",
    "flights-sync:done",
  ])
  expect(tab.sent[1]).toMatchObject({ id: "2" })
  expect(tab.requests.filter((url) => url.includes("idSession"))).toEqual([
    "/ficheVol.php?l=en&idSession=2&maxHeight=600",
    "/scripts/downloadFlightFile.php?idSession=2&type=igc&key=k",
  ])
})

test("waits and retries when Syride rate-limits a request", async () => {
  const tab = syride({ rateLimited: true })
  await tab.run()
  expect(tab.requests.slice(0, 2)).toEqual([
    "/en/pilots/pilot",
    "/en/pilots/pilot",
  ])
  expect(tab.synced()).toHaveLength(3)
})
