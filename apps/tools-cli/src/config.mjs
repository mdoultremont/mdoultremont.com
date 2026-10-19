import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { z } from "zod"

export const credentialsSchema = z.object({
  origin: z.string().url(),
  issuer: z.string().url(),
  resource: z.string().url(),
  client: z.object({
    client_id: z.string().min(1),
    redirect_uris: z.array(z.string().url()),
    token_endpoint_auth_method: z.literal("none"),
  }),
  tokens: z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_at: z.number(),
    scope: z.string().optional(),
  }),
  refreshPending: z.boolean().optional(),
})
/** @typedef {z.infer<typeof credentialsSchema>} Credentials */

/** @param {string} value */
export function secureUrl(value) {
  const url = new URL(value)
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error("Credentials require HTTPS, except on loopback HTTP")
  }
  return url
}

/** @param {string} value */
export function toolsOrigin(value) {
  const url = secureUrl(value)
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error(
      "--url must be an origin without a path, query, or fragment"
    )
  return url.origin
}

/** @param {string} origin */
export function credentialPath(origin) {
  const dir =
    process.env.TOOLS_CONFIG_DIR ||
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "mdoultremont-tools"
    )
  return join(dir, `${createHash("sha256").update(origin).digest("hex")}.json`)
}

/** @param {string} path */
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Credential directory must be a real directory")
  await chmod(path, 0o700)
}

/** @param {string} path @param {Credentials} value */
export async function saveCredentials(path, value) {
  await privateDirectory(dirname(path))
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify(credentialsSchema.parse(value)))
    await handle.sync()
    await handle.close()
    await rename(temporary, path)
  } finally {
    await handle.close()
    await rm(temporary, { force: true })
  }
}

/** @param {string} path @returns {Promise<Credentials | undefined>} */
export async function readCredentials(path) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Credential file must be a regular file")
    await chmod(path, 0o600)
    return credentialsSchema.parse(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined
    throw error
  }
}

/** @template T @param {string} path @param {(signal: AbortSignal) => Promise<T>} operation */
export async function withCredentialLock(path, operation) {
  await privateDirectory(dirname(path))
  const lockPath = `${path}.lock`
  const deadline = Date.now() + 15_000
  const controller = new AbortController()
  let owned = false
  let exitCode = 0
  const onSigint = () => {
    exitCode = 130
    controller.abort()
  }
  const onSigterm = () => {
    exitCode = 143
    controller.abort()
  }
  process.on("SIGINT", onSigint)
  process.on("SIGTERM", onSigterm)
  try {
    while (!owned) {
      controller.signal.throwIfAborted()
      try {
        await mkdir(lockPath, { mode: 0o700 })
        owned = true
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error
        if (Date.now() > deadline)
          throw new Error(
            `Credentials are locked. If no tools process is running, remove ${lockPath}`,
            { cause: error }
          )
        await delay(50, undefined, { signal: controller.signal })
      }
    }
    controller.signal.throwIfAborted()
    return await operation(controller.signal)
  } finally {
    if (owned) await rm(lockPath, { recursive: true, force: true })
    process.off("SIGINT", onSigint)
    process.off("SIGTERM", onSigterm)
    if (exitCode) process.exit(exitCode)
  }
}
