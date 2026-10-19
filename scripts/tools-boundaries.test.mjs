import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { inspectToolsBoundaries } from "./check-tools-boundaries.mjs"

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "tools-boundaries-"))
  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  for (const [directory, name, exports] of [
    ["apps/tools", "tools", {}],
    [
      "apps/tools-backend",
      "tools-backend",
      {
        "./http": "./src/entrypoints/http/index.ts",
        "./worker": "./src/entrypoints/worker.ts",
      },
    ],
    ["apps/tools-cli", "tools-cli", {}],
    [
      "packages/tools-contracts",
      "tools-contracts",
      { ".": "./src/actions/index.ts", "./client": "./src/actions/client.ts" },
    ],
    ["packages/flight-track", "flight-track", { ".": "./src/index.ts" }],
  ])
    write(
      `${directory}/package.json`,
      JSON.stringify({
        name: `@mdoultremont/${name}`,
        exports,
        dependencies: {
          "@mdoultremont/tools-contracts": "workspace:*",
          "@mdoultremont/tools-backend": "workspace:*",
        },
      })
    )
  try {
    run({ root, write })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("accepts Worker mounting and remote clients using public contracts", () =>
  fixture(({ root, write }) => {
    write(
      "apps/tools/src/server.ts",
      'export { createToolsFetch } from "@mdoultremont/tools-backend/worker"'
    )
    write(
      "apps/tools/src/features/api.ts",
      'import { createActionsClient } from "@mdoultremont/tools-contracts/client"'
    )
    assert.deepEqual(inspectToolsBoundaries(root), [])
  }))

for (const [name, path, contents, message] of [
  [
    "backend importing web by relative path",
    "apps/tools-backend/src/index.ts",
    'export * from "../../tools/src/features/api"',
    "application implementation",
  ],
  [
    "backend importing TanStack",
    "apps/tools-backend/src/index.ts",
    'import { createServerFn } from "@tanstack/react-start"',
    "framework",
  ],
  [
    "contracts importing backend types",
    "packages/tools-contracts/src/index.ts",
    'import type { User } from "@mdoultremont/tools-backend/http"',
    "application implementation",
  ],
  [
    "contracts importing React",
    "packages/tools-contracts/src/index.ts",
    'import React from "react"',
    "framework",
  ],
  [
    "contracts importing a backend type expression",
    "packages/tools-contracts/src/index.ts",
    'type User = import("@mdoultremont/tools-backend/http").User',
    "application implementation",
  ],
  [
    "CLI importing server dynamically",
    "apps/tools-cli/src/cli.mjs",
    'await import("@mdoultremont/tools-backend/http")',
    "application implementation",
  ],
  [
    "CLI importing server with a template literal",
    "apps/tools-cli/src/cli.mjs",
    "await import(`@mdoultremont/tools-backend/http`)",
    "application implementation",
  ],
  [
    "web importing server from a component",
    "apps/tools/src/features/api.ts",
    'import { currentUser } from "@mdoultremont/tools-backend/http"',
    "only Worker composition",
  ],
  [
    "consumer bypassing exports",
    "apps/tools/src/server.ts",
    'import { UserAuth } from "@mdoultremont/tools-backend/src/actions/auth"',
    "subpath is private",
  ],
  [
    "module pointing up a layer",
    "apps/tools-backend/src/modules/database/index.ts",
    'import { Auth } from "#backend/actions/auth"',
    "point down",
  ],
  [
    "module pointing up through a relative path",
    "apps/tools-backend/src/modules/database/index.ts",
    'export { Auth } from "../../actions/auth"',
    "point down",
  ],
  [
    "unit bypassing another unit's public API",
    "apps/tools-backend/src/actions/auth/index.ts",
    'import { schema } from "../../modules/database/schema"',
    "index.ts public API",
  ],
])
  test(`rejects ${name}`, () =>
    fixture(({ root, write }) => {
      write(path, contents)
      assert.ok(
        inspectToolsBoundaries(root).some((error) => error.includes(message))
      )
    }))
