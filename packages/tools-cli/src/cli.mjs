#!/usr/bin/env node
import { parseArgs } from "node:util"
import { lstat } from "node:fs/promises"
import { toolsOrigin } from "./config.mjs"
import { accessToken, login, logout } from "./oauth.mjs"
import { attachFile, call, download, manifest, readInput } from "./remote.mjs"

const HELP = `Usage: tools [--url <origin>] <command>

Commands:
  actions                         List all available actions and JSON Schemas
  call <name> [--json <object>]    Invoke a remote action
  <name> [--json <object>]         Shorthand for call
  help [name]                     Show help or an action's schema
  login [--no-browser]            Sign in with OAuth and PKCE
  logout                          Revoke and remove stored credentials

Options:
  --json '<object>' | @file | -    JSON object, JSON file, or stdin (default {})
  --file <path>                   Attach a UTF-8 import file, at most 5 MB
  --output <path>                 Save a file response to an explicit path
  --force                         Allow replacing an existing output file
  --url <origin>                  Override TOOLS_URL (default https://tools.mdoultremont.com)
  --no-browser                    Print the login URL without opening a browser
  --help, -h                      Show help

Headless: set TOOLS_TOKEN to an OAuth access token. Stored sessions refresh automatically.
Credentials: TOOLS_CONFIG_DIR or $XDG_CONFIG_HOME/mdoultremont-tools (mode 0700/0600).
`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      json: { type: "string" },
      file: { type: "string" },
      output: { type: "string" },
      force: { type: "boolean", default: false },
      "no-browser": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  const [command, ...args] = positionals
  if (
    !command ||
    (values.help &&
      positionals.length === 1 &&
      ["help", "actions", "login", "logout"].includes(command)) ||
    (command === "help" && !args.length)
  ) {
    process.stdout.write(HELP)
    return
  }
  const origin = toolsOrigin(
    values.url || process.env.TOOLS_URL || "https://tools.mdoultremont.com"
  )
  if (command === "login" || command === "logout") {
    if (
      args.length ||
      values.json ||
      values.file ||
      values.output ||
      values.force
    )
      throw new Error(`Invalid arguments for ${command}`)
    print(
      command === "login"
        ? await login(origin, { noBrowser: values["no-browser"] })
        : await logout(origin)
    )
    return
  }
  const name = ["call", "help"].includes(command) ? args[0] : command
  if (
    (command === "call" && args.length !== 1) ||
    (command === "help" && args.length > 1) ||
    (!["call", "help"].includes(command) && args.length)
  )
    throw new Error("Expected one action name; see tools help")
  if (
    command === "actions" &&
    (values.json || values.file || values.output || values.force)
  )
    throw new Error("actions does not take action arguments")
  if (values.force && !values.output)
    throw new Error("--force requires --output")
  const token = await accessToken(origin)
  const available = await manifest(origin, token)
  if (command === "actions") {
    print(available)
    return
  }
  const action = available.actions.find((candidate) => candidate.name === name)
  if (!action) throw new Error(`Unknown action: ${name}`)
  if (command === "help" || values.help) {
    print(action)
    return
  }
  if (values.output && !values.force) {
    try {
      await lstat(values.output)
      throw new Error("Output already exists; use --force to replace it")
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error
    }
  }
  let input = await readInput(values.json)
  if (values.file) input = await attachFile(action, input, values.file)
  const result = await call(origin, token, action, input)
  print(
    values.output ? await download(result, values.output, values.force) : result
  )
}

/** @param {unknown} value */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : "Request failed"
  const token = process.env.TOOLS_TOKEN
  process.stderr.write(
    `tools: ${token ? message.replaceAll(token, "[redacted]") : message}\n`
  )
  process.exitCode = 1
}
