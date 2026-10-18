import { open, readFile, rename, rm } from "node:fs/promises"
import { basename } from "node:path"
import { z } from "zod"
import {
  actionRequest,
  filePayload,
  jsonObject,
  normalizeManifest,
} from "./contracts.mjs"

const MAX_FILE_BYTES = 5_000_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const apiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

/** @param {Response} response */
async function responseJson(response) {
  const reader = response.body?.getReader()
  const chunks = []
  let size = 0
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_RESPONSE_BYTES)
          throw new Error("HTTP response exceeds 8 MB")
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
  }
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch (error) {
    if (response.ok) throw error
  }
  if (!response.ok) {
    const error = apiError.safeParse(raw)
    const details = error.success
      ? ` ${error.data.error.code}: ${error.data.error.message}`
      : ""
    const guidance = response.status === 401 ? "; run tools login again" : ""
    throw new Error(`HTTP ${response.status}${details}${guidance}`)
  }
  return raw
}

/** @param {string} origin @param {string} token */
export async function manifest(origin, token) {
  return normalizeManifest(
    await responseJson(
      await fetch(new URL("/api/v1", origin), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      })
    )
  )
}

/** @param {string | undefined} source */
export async function readInput(source) {
  let text = source || "{}"
  if (source === "-") {
    const chunks = []
    let size = 0
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_RESPONSE_BYTES) throw new Error("JSON input exceeds 8 MB")
      chunks.push(bytes)
    }
    text = Buffer.concat(chunks).toString("utf8")
  } else if (source?.startsWith("@")) {
    text = await readFile(source.slice(1), "utf8")
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
      throw new Error("JSON input exceeds 8 MB")
  }
  return jsonObject.parse(JSON.parse(text))
}

/** @param {import('./contracts.mjs').ActionDescriptor} action @param {import('./contracts.mjs').JsonObject} input @param {string} path */
export async function attachFile(action, input, path) {
  if (!action.file) throw new Error("This action does not accept --file")
  const { contentField, filenameField } = action.file
  if (contentField in input || filenameField in input)
    throw new Error("--file fields must not also be supplied in --json")
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null
      )
      if (bytesRead === 0) break
      size += bytesRead
    }
    if (size > MAX_FILE_BYTES) throw new Error("Import file exceeds 5 MB")
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(buffer.subarray(0, size))
    return { ...input, [contentField]: text, [filenameField]: basename(path) }
  } finally {
    await handle.close()
  }
}

/** @param {string} origin @param {string} token @param {import('./contracts.mjs').ActionDescriptor} action @param {import('./contracts.mjs').JsonObject} input */
export async function call(origin, token, action, input) {
  const request = actionRequest(action, input, origin)
  return responseJson(
    await fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    })
  )
}

/** @param {unknown} raw @param {string} path @param {boolean} force */
export async function download(raw, path, force) {
  const file = filePayload.parse(raw)
  const bytes = Buffer.from(file.contentBase64, "base64")
  if (
    bytes.length !== file.sizeBytes ||
    bytes.toString("base64") !== file.contentBase64
  )
    throw new Error("Download size or base64 encoding is invalid")
  const destination = force
    ? `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
    : path
  const handle = await open(destination, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.close()
    if (force) await rename(destination, path)
  } finally {
    await handle.close()
    if (force) await rm(destination, { force: true })
  }
  return {
    filename: file.filename,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    output: path,
  }
}
