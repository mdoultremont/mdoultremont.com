import { z } from "zod"

export const jsonObject = z.record(z.string(), z.json())
const objectSchema = jsonObject.refine(
  (schema) => schema.type === "object",
  "Expected object JSON Schema"
)
const actionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: objectSchema,
  outputSchema: objectSchema,
  http: z.object({
    method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: z
      .string()
      .regex(/^\/[A-Za-z0-9_./:-]*$/)
      .refine(
        (path) => !path.split("/").some((part) => part === "." || part === "..")
      ),
  }),
  file: z
    .object({
      contentField: z.string().min(1),
      filenameField: z.string().min(1),
    })
    .optional(),
})

/** @typedef {z.infer<typeof actionSchema>} ActionDescriptor */
/** @typedef {z.infer<typeof jsonObject>} JsonObject */

/** @param {unknown} raw */
export function normalizeManifest(raw) {
  const manifest = z.object({ actions: z.array(actionSchema) }).parse(raw)
  if (
    new Set(manifest.actions.map((action) => action.name)).size !==
    manifest.actions.length
  ) {
    throw new Error("Manifest contains duplicate action names")
  }
  return manifest
}

export const filePayload = z.object({
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative().max(5_000_000),
  contentBase64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
})

/** @param {ActionDescriptor} action @param {JsonObject} input @param {string} origin */
export function actionRequest(action, input, origin) {
  const remaining = { ...input }
  const path = action.http.path.replace(
    /:([A-Za-z][A-Za-z0-9_]*)/g,
    (_match, key) => {
      const value = input[key]
      if (
        (typeof value !== "string" && typeof value !== "number") ||
        value === "" ||
        value === "." ||
        value === ".."
      ) {
        throw new Error(`Missing or invalid path parameter: ${key}`)
      }
      delete remaining[key]
      return encodeURIComponent(String(value))
    }
  )
  const url = new URL(`/api/v1${path}`, origin)
  if (action.http.method === "GET") {
    if (Object.keys(remaining).length)
      url.searchParams.set("input", JSON.stringify(remaining))
    return { url, method: action.http.method }
  }
  return { url, method: action.http.method, body: JSON.stringify(remaining) }
}
