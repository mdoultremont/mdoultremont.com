import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url))
const object = { type: "object", properties: {} }
const descriptor = (name, method, path, extra = {}) => ({
  name,
  description: `Perform ${name}`,
  inputSchema: object,
  outputSchema: object,
  http: { method, path },
  ...extra,
})
let actions = []
let origin
let directory
let requests = []
let tokenCalls = []
let revoked = []
let clients = new Map()
let codes = new Map()
let nextToken = 0
let validTokens = new Set(["headless-token"])
let refreshTokens = new Set()
let dropRefresh = false
let slowRefresh
let slowRevoke
const bytes = Buffer.from([0, 255, 128, 10])
let downloadBytes = bytes

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}
function json(response, value, status = 200) {
  response
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(value))
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin)
    if (url.pathname === "/.well-known/oauth-protected-resource/api")
      return json(response, {
        resource: `${origin}/api`,
        authorization_servers: [`${origin}/api/auth`],
      })
    if (url.pathname === "/.well-known/oauth-authorization-server/api/auth")
      return json(response, {
        issuer: `${origin}/api/auth`,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
      })
    if (url.pathname === "/register") {
      const metadata = JSON.parse(await body(request))
      assert.equal(metadata.application_type, "native")
      assert.equal(metadata.token_endpoint_auth_method, "none")
      assert.deepEqual(metadata.grant_types, [
        "authorization_code",
        "refresh_token",
      ])
      const client_id = `client-${clients.size}`
      clients.set(client_id, metadata)
      return json(response, { ...metadata, client_id }, 201)
    }
    if (url.pathname === "/authorize") {
      const params = url.searchParams
      const client = clients.get(params.get("client_id"))
      assert.ok(client.redirect_uris.includes(params.get("redirect_uri")))
      assert.equal(params.get("code_challenge_method"), "S256")
      assert.equal(params.get("resource"), `${origin}/api`)
      assert.equal(params.get("scope"), "tools offline_access")
      assert.ok(params.get("state").length >= 32)
      const code = `code-${codes.size}`
      codes.set(code, Object.fromEntries(params))
      const callback = new URL(params.get("redirect_uri"))
      callback.search = new URLSearchParams({
        code,
        state: params.get("state"),
        iss: `${origin}/api/auth`,
      }).toString()
      response.writeHead(302, { Location: callback.href }).end()
      return
    }
    if (url.pathname === "/token") {
      const params = new URLSearchParams(await body(request))
      tokenCalls.push(Object.fromEntries(params))
      assert.equal(params.get("resource"), `${origin}/api`)
      if (params.get("grant_type") === "authorization_code") {
        const code = codes.get(params.get("code"))
        assert.ok(code)
        codes.delete(params.get("code"))
        assert.equal(params.get("client_id"), code.client_id)
        assert.equal(params.get("redirect_uri"), code.redirect_uri)
        assert.equal(
          createHash("sha256")
            .update(params.get("code_verifier"))
            .digest("base64url"),
          code.code_challenge
        )
      } else {
        const refresh = params.get("refresh_token")
        if (!refreshTokens.delete(refresh))
          return json(response, { error: "invalid_grant" }, 400)
        if (dropRefresh) {
          request.socket.destroy()
          return
        }
        if (slowRefresh) {
          slowRefresh.accept()
          await slowRefresh.promise
        } else {
          await new Promise((resolve) => setTimeout(resolve, 80))
        }
      }
      const access_token = `access-secret-${++nextToken}`
      const refresh_token = `refresh-secret-${nextToken}`
      validTokens.add(access_token)
      refreshTokens.add(refresh_token)
      return json(response, {
        access_token,
        refresh_token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "tools offline_access",
      })
    }
    if (url.pathname === "/revoke") {
      const params = new URLSearchParams(await body(request))
      revoked.push(params.get("token"))
      if (slowRevoke) {
        slowRevoke.accept()
        await slowRevoke.promise
      }
      refreshTokens.delete(params.get("token"))
      validTokens.delete(params.get("token"))
      response.writeHead(200).end()
      return
    }
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    })
    if (
      !validTokens.has(request.headers.authorization?.replace(/^Bearer /, ""))
    )
      return json(
        response,
        { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
        401
      )
    const errorBody = {
      "/api/v1/text401": [401, "text/plain", "Unauthorized"],
      "/api/v1/empty401": [401, "text/plain", ""],
      "/api/v1/html502": [502, "text/html", "<html>Bad gateway</html>"],
    }[url.pathname]
    if (errorBody) {
      response
        .writeHead(errorBody[0], { "Content-Type": errorBody[1] })
        .end(errorBody[2])
      return
    }
    if (url.pathname === "/api/v1") return json(response, { actions })
    if (url.pathname === "/api/v1/failure")
      return json(
        response,
        { error: { code: "CONFLICT", message: "Already imported" } },
        409
      )
    if (url.pathname === "/api/v1/uncertain") {
      request.socket.destroy()
      return
    }
    if (url.pathname === "/api/v1/download")
      return json(response, {
        filename: "été.igc",
        contentType: "application/octet-stream",
        sizeBytes: downloadBytes.length,
        contentBase64: downloadBytes.toString("base64"),
      })
    if (url.pathname === "/api/v1/bad-download")
      return json(response, {
        filename: "bad",
        contentType: "application/octet-stream",
        sizeBytes: 9,
        contentBase64: bytes.toString("base64"),
      })
    const input =
      request.method === "GET"
        ? JSON.parse(url.searchParams.get("input") || "{}")
        : JSON.parse(await body(request))
    return json(response, { method: request.method, path: url.pathname, input })
  } catch (error) {
    json(response, { error: { code: "FIXTURE", message: error.message } }, 500)
  }
})

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "tools-cli-test-"))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  actions = [
    descriptor("demo.read", "GET", "/items/:id"),
    descriptor("demo.update", "PATCH", "/items/:id"),
    descriptor("demo.import", "POST", "/import", {
      file: { contentField: "trackText", filenameField: "trackFilename" },
    }),
    descriptor("demo.download", "GET", "/download"),
    descriptor("demo.bad-download", "GET", "/bad-download"),
    descriptor("demo.fail", "DELETE", "/failure"),
    descriptor("demo.uncertain", "POST", "/uncertain"),
    ...["text401", "empty401", "html502"].map((name) =>
      descriptor(`demo.${name}`, "POST", `/${name}`)
    ),
  ]
})
after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

function start(
  args,
  {
    token = "headless-token",
    config = join(directory, "config"),
    env = {},
    stdin,
  } = {}
) {
  const child = spawn(process.execPath, [cli, "--url", origin, ...args], {
    env: {
      ...process.env,
      TOOLS_TOKEN: token,
      TOOLS_CONFIG_DIR: config,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const done = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr })
    )
  })
  child.stdin.end(stdin)
  return { child, done }
}
async function run(args, options) {
  return start(args, options).done
}
function successful(result) {
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}

async function beginLogin(config) {
  const execution = start(["login", "--no-browser"], { token: "", config })
  const authorize = await new Promise((resolve, reject) => {
    let text = ""
    execution.child.stderr.on("data", (chunk) => {
      text += chunk
      const url = text.match(/\n(http[^\n]+)\n/)
      if (url) resolve(new URL(url[1]))
    })
    execution.child.once("close", (code) =>
      reject(new Error(`Login exited ${code}: ${text}`))
    )
  })
  return { ...execution, authorize }
}
async function signIn(config, tamper) {
  const execution = await beginLogin(config)
  const redirect = await fetch(execution.authorize, { redirect: "manual" })
  assert.equal(redirect.status, 302)
  const callback = new URL(redirect.headers.get("location"))
  if (tamper) tamper(callback)
  const response = await fetch(callback)
  const result = await execution.done
  return { result, response, callback }
}
async function configFiles(config) {
  try {
    return await readdir(config)
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}
async function saved(config) {
  const file = (await readdir(config)).find((name) => name.endsWith(".json"))
  return {
    path: join(config, file),
    credentials: JSON.parse(await readFile(join(config, file), "utf8")),
  }
}

test("help needs no credentials; manifest and action help reflect runtime additions", async () => {
  const help = await run(["help"], { token: "" })
  assert.equal(help.code, 0)
  assert.match(help.stdout, /tools.*command/)
  assert.ok(
    successful(await run(["actions"])).actions.some(
      (action) => action.name === "demo.read"
    )
  )
  actions.push(descriptor("new.runtime.action", "PUT", "/runtime"))
  assert.equal(
    successful(await run(["help", "new.runtime.action"])).http.method,
    "PUT"
  )
  assert.equal(
    successful(await run(["new.runtime.action"])).path,
    "/api/v1/runtime"
  )
})

test("JSON object, @file, stdin, path escaping, and GET query preserve input", async () => {
  const input = { id: "été/a?b#c", filter: "été & 雪", page: 2 }
  const result = successful(
    await run(["call", "demo.read", "--json", JSON.stringify(input)])
  )
  assert.equal(result.path, "/api/v1/items/%C3%A9t%C3%A9%2Fa%3Fb%23c")
  assert.deepEqual(result.input, { filter: "été & 雪", page: 2 })
  const path = join(directory, "input.json")
  await writeFile(path, JSON.stringify(input))
  for (const options of [
    { source: `@${path}` },
    { source: "-", stdin: JSON.stringify(input) },
  ]) {
    const updated = successful(
      await run(["call", "demo.update", "--json", options.source], {
        stdin: options.stdin,
      })
    )
    assert.equal(updated.method, "PATCH")
    assert.deepEqual(updated.input, { filter: "été & 雪", page: 2 })
  }
  assert.equal(requests.at(-1).authorization, "Bearer headless-token")
  for (const source of ["[]", "null", '{"id":".."}', "{}"])
    assert.equal((await run(["call", "demo.read", "--json", source])).code, 1)
})

test("UTF-8 file metadata, byte cap, invalid UTF-8, and field conflicts", async () => {
  const path = join(directory, "été.gpx")
  const text = '\uFEFF<gpx>été & 雪\n"\\</gpx>'
  await writeFile(path, text)
  assert.deepEqual(
    successful(await run(["call", "demo.import", "--file", path])).input,
    { trackText: text, trackFilename: "été.gpx" }
  )
  const count = requests.filter(
    (request) => request.url === "/api/v1/import"
  ).length
  await writeFile(path, Buffer.alloc(5_000_001, "a"))
  assert.match(
    (await run(["call", "demo.import", "--file", path])).stderr,
    /exceeds 5 MB/
  )
  await writeFile(path, Buffer.from([255]))
  assert.equal((await run(["call", "demo.import", "--file", path])).code, 1)
  assert.equal(
    (
      await run([
        "call",
        "demo.import",
        "--file",
        path,
        "--json",
        '{"trackText":"duplicate"}',
      ])
    ).code,
    1
  )
  assert.equal(
    requests.filter((request) => request.url === "/api/v1/import").length,
    count
  )
})

test("download preserves binary bytes and requires explicit overwrite", async () => {
  const path = join(directory, "download.igc")
  const result = successful(
    await run(["call", "demo.download", "--output", path])
  )
  assert.equal(result.sizeBytes, bytes.length)
  assert.deepEqual(await readFile(path), bytes)
  await writeFile(path, "keep me")
  const count = requests.length
  assert.equal((await run(["call", "demo.download", "--output", path])).code, 1)
  assert.equal(requests.length, count + 1)
  assert.equal(await readFile(path, "utf8"), "keep me")
  successful(await run(["call", "demo.download", "--output", path, "--force"]))
  assert.deepEqual(await readFile(path), bytes)
  assert.equal(
    (await run(["call", "demo.bad-download", "--output", path, "--force"]))
      .code,
    1
  )
  assert.deepEqual(await readFile(path), bytes)
})

test("API errors use stderr and a network failure never replays a mutation", async () => {
  const result = await run(["call", "demo.fail"])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /CONFLICT: Already imported/)
  assert.equal((await run(["actions"], { token: "invalid" })).code, 1)
  const count = requests.filter(
    (request) => request.url === "/api/v1/uncertain"
  ).length
  assert.equal((await run(["call", "demo.uncertain"])).code, 1)
  assert.equal(
    requests.filter((request) => request.url === "/api/v1/uncertain").length,
    count + 1
  )
  assert.match(
    (await run(["--url", "http://example.com", "actions"])).stderr,
    /require HTTPS/
  )
})

test("OAuth discovery, DCR, PKCE callback, private persistence, refresh serialization, and revocation", async () => {
  const config = join(directory, "oauth")
  const { result, callback } = await signIn(config)
  assert.deepEqual(successful(result), { authenticated: true, origin })
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /access-secret|refresh-secret/
  )
  const { path, credentials } = await saved(config)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal((await stat(config)).mode & 0o777, 0o700)
  await assert.rejects(fetch(callback))
  credentials.tokens.expires_at = 0
  await writeFile(path, JSON.stringify(credentials))
  const count = tokenCalls.length
  const results = await Promise.all([
    run(["actions"], { token: "", config }),
    run(["actions"], { token: "", config }),
  ])
  results.forEach(successful)
  assert.equal(tokenCalls.length, count + 1)
  const refreshed = (await saved(config)).credentials
  assert.notEqual(
    refreshed.tokens.refresh_token,
    credentials.tokens.refresh_token
  )
  assert.doesNotMatch(
    results.map((execution) => execution.stdout + execution.stderr).join(""),
    /access-secret|refresh-secret/
  )
  successful(await run(["logout"], { token: "", config }))
  assert.ok(revoked.includes(refreshed.tokens.refresh_token))
  assert.ok(revoked.includes(refreshed.tokens.access_token))
  assert.deepEqual(await configFiles(config), [])
  assert.equal((await run(["actions"], { token: "", config })).code, 1)
})

test("OAuth refuses mismatched state and issuer and closes its callback listener", async () => {
  for (const [key, value] of [
    ["state", "wrong"],
    ["iss", "https://attacker.example"],
  ]) {
    const config = join(directory, `invalid-${key}`)
    const count = tokenCalls.length
    const { result, response, callback } = await signIn(config, (url) =>
      url.searchParams.set(key, value)
    )
    assert.equal(response.status, 400)
    assert.equal(result.code, 1)
    assert.equal(tokenCalls.length, count)
    await assert.rejects(fetch(callback))
    assert.deepEqual(await configFiles(config), [])
  }
})

test("OAuth login times out and releases callback and credential lock", async () => {
  const config = join(directory, "timeout")
  const result = await run(["login", "--no-browser"], {
    token: "",
    config,
    env: { TOOLS_LOGIN_TIMEOUT_MS: "50" },
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /timed out/)
  const authorize = new URL(result.stderr.match(/\n(http[^\n]+)\n/)[1])
  await assert.rejects(fetch(authorize.searchParams.get("redirect_uri")))
  assert.deepEqual(await configFiles(config), [])
})

test("a lost rotating refresh response requires login instead of replaying the refresh", async () => {
  const config = join(directory, "uncertain-refresh")
  successful((await signIn(config)).result)
  const { path, credentials } = await saved(config)
  credentials.tokens.expires_at = 0
  await writeFile(path, JSON.stringify(credentials))
  dropRefresh = true
  const count = tokenCalls.length
  try {
    assert.equal((await run(["actions"], { token: "", config })).code, 1)
    assert.match(
      (await run(["actions"], { token: "", config })).stderr,
      /refresh was interrupted/
    )
    assert.equal(tokenCalls.length, count + 1)
  } finally {
    dropRefresh = false
  }
})

test("HTTP errors preserve status, structured errors, and login guidance without replaying mutations", async () => {
  for (const [name, status] of [
    ["text401", 401],
    ["empty401", 401],
    ["html502", 502],
  ]) {
    const count = requests.filter(
      (request) => request.url === `/api/v1/${name}`
    ).length
    const result = await run(["call", `demo.${name}`])
    assert.equal(result.code, 1)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, new RegExp(`HTTP ${status}`))
    assert.doesNotMatch(
      result.stderr,
      /SyntaxError|Unexpected token|Unexpected end/
    )
    if (status === 401) assert.match(result.stderr, /tools login/)
    assert.equal(
      requests.filter((request) => request.url === `/api/v1/${name}`).length,
      count + 1
    )
  }
  const unauthorized = await run(["actions"], { token: "invalid" })
  assert.match(unauthorized.stderr, /HTTP 401.*UNAUTHORIZED: Sign in required/)
  assert.match(unauthorized.stderr, /tools login/)
  assert.match(
    (await run(["call", "demo.fail"])).stderr,
    /HTTP 409.*CONFLICT: Already imported/
  )
})

test("imports and downloads accept exactly 5,000,000 bytes and reject one more", async () => {
  const input = join(directory, "boundary.gpx")
  const output = join(directory, "boundary.igc")
  const text = "é".repeat(2_500_000)
  await writeFile(input, text)
  assert.ok(
    successful(await run(["call", "demo.import", "--file", input])).input
      .trackText === text
  )
  const count = requests.filter(
    (request) => request.url === "/api/v1/import"
  ).length
  await writeFile(input, text + "a")
  assert.match(
    (await run(["call", "demo.import", "--file", input])).stderr,
    /exceeds 5 MB/
  )
  assert.equal(
    requests.filter((request) => request.url === "/api/v1/import").length,
    count
  )
  try {
    downloadBytes = Buffer.alloc(5_000_000, "a")
    assert.equal(
      successful(await run(["call", "demo.download", "--output", output]))
        .sizeBytes,
      5_000_000
    )
    assert.deepEqual(await readFile(output), downloadBytes)
    downloadBytes = Buffer.alloc(5_000_001, "b")
    assert.equal(
      (await run(["call", "demo.download", "--output", output, "--force"]))
        .code,
      1
    )
    assert.deepEqual(await readFile(output), Buffer.alloc(5_000_000, "a"))
  } finally {
    downloadBytes = bytes
  }
})

function slowRequest() {
  const { promise, resolve } = Promise.withResolvers()
  const { promise: received, resolve: accept } = Promise.withResolvers()
  return { promise, resolve, received, accept }
}
async function interrupt(execution, signal) {
  assert.ok(execution.child.kill(signal))
  const timer = setTimeout(() => execution.child.kill("SIGKILL"), 2_000)
  try {
    const result = await execution.done
    assert.ok(
      result.signal === signal ||
        result.code === (signal === "SIGINT" ? 130 : 143),
      JSON.stringify(result)
    )
    assert.equal(result.stdout, "")
  } finally {
    clearTimeout(timer)
  }
}
async function noLock(config) {
  assert.ok(!(await configFiles(config)).some((name) => name.endsWith(".lock")))
}

test(
  "interrupted login leaves no lock and another command and login succeed",
  { timeout: 10_000 },
  async () => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const config = join(directory, `login-${signal}`)
      successful((await signIn(config)).result)
      const execution = await beginLogin(config)
      try {
        successful(await run(["actions"], { token: "", config }))
      } finally {
        await interrupt(execution, signal)
      }
      await noLock(config)
      await assert.rejects(
        fetch(execution.authorize.searchParams.get("redirect_uri"))
      )
      successful(await run(["actions"], { token: "", config }))
      successful((await signIn(config)).result)
    }
  }
)

test(
  "interrupted refresh releases its lock but never replays a pending token",
  { timeout: 10_000 },
  async () => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const config = join(directory, `refresh-${signal}`)
      successful((await signIn(config)).result)
      const { path, credentials } = await saved(config)
      credentials.tokens.expires_at = 0
      await writeFile(path, JSON.stringify(credentials))
      const slow = slowRequest()
      slowRefresh = slow
      const count = tokenCalls.length
      const execution = start(["actions"], { token: "", config })
      try {
        await slow.received
        await interrupt(execution, signal)
        await noLock(config)
        assert.equal((await saved(config)).credentials.refreshPending, true)
        const result = await run(["actions"], { token: "", config })
        assert.equal(result.code, 1)
        assert.match(result.stderr, /refresh was interrupted.*tools login/)
        assert.equal(tokenCalls.length, count + 1)
        successful((await signIn(config)).result)
        successful(await run(["actions"], { token: "", config }))
        assert.equal(tokenCalls.length, count + 2)
      } finally {
        slow.resolve()
        slowRefresh = undefined
        execution.child.kill("SIGKILL")
      }
    }
  }
)

test(
  "interrupted logout clears local credentials and releases its lock",
  { timeout: 10_000 },
  async () => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const config = join(directory, `logout-${signal}`)
      successful((await signIn(config)).result)
      const slow = slowRequest()
      slowRevoke = slow
      const execution = start(["logout"], { token: "", config })
      try {
        await slow.received
        await interrupt(execution, signal)
        assert.deepEqual(await readdir(config), [])
        assert.match(
          (await run(["actions"], { token: "", config })).stderr,
          /Run tools login/
        )
        successful((await signIn(config)).result)
      } finally {
        slow.resolve()
        slowRevoke = undefined
        execution.child.kill("SIGKILL")
      }
    }
  }
)
