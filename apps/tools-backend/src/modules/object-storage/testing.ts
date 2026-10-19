/**
 * Test-only stand-in for an R2 bucket binding: in-memory, with the subset of
 * the API the module uses (put, get, delete, list with prefix/cursor/limit).
 * Not exported from the index.
 */
export function makeFakeR2() {
  const stored = new Map<
    string,
    { bytes: Uint8Array; contentType?: string; custom?: Record<string, string> }
  >()
  const calls = { list: 0, delete: [] as string[][] }
  const bucket = {
    put: async (
      key: string,
      value: Uint8Array | ReadableStream<Uint8Array>,
      options?: {
        httpMetadata?: { contentType?: string }
        customMetadata?: Record<string, string>
      }
    ) => {
      const bytes =
        value instanceof Uint8Array
          ? new Uint8Array(value)
          : new Uint8Array(await new Response(value).arrayBuffer())
      stored.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType,
        custom: options?.customMetadata,
      })
    },
    get: async (key: string) => {
      const item = stored.get(key)
      if (!item) return null
      return {
        key,
        size: item.bytes.byteLength,
        httpEtag: `"${key}"`,
        httpMetadata: { contentType: item.contentType },
        customMetadata: item.custom ?? {},
        body: new Blob([new Uint8Array(item.bytes)]).stream(),
      }
    },
    delete: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      calls.delete.push(list)
      for (const key of list) stored.delete(key)
    },
    list: async (options?: {
      prefix?: string
      cursor?: string
      limit?: number
    }) => {
      calls.list++
      const limit = options?.limit ?? 1000
      const all = [...stored.keys()].filter((key) =>
        key.startsWith(options?.prefix ?? "")
      )
      // oxlint-disable-next-line unicorn/no-array-sort -- freshly filtered copy
      all.sort()
      // Like R2, the cursor is a key position, so deleting while paging is safe.
      const rest = options?.cursor
        ? all.filter((key) => key > options.cursor!)
        : all
      const page = rest.slice(0, limit)
      const truncated = rest.length > limit
      return {
        objects: page.map((key) => ({ key })),
        truncated,
        cursor: truncated ? page.at(-1) : undefined,
      }
    },
  }
  return Object.assign(bucket as unknown as R2Bucket, { stored, calls })
}
