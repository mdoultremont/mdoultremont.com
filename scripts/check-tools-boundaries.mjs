import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const packages = {
  web: "apps/tools",
  backend: "apps/tools-backend",
  contracts: "packages/tools-contracts",
  cli: "apps/tools-cli",
}
const hostEntries = new Set([
  "src/server.ts",
  "src/routes/_apps/route.tsx",
  "src/routes/oauth/consent.tsx",
  "src/routes/api/auth/$.ts",
  "src/routes/api/invitations/accept.ts",
  "src/routes/api/music/spotify/connect.ts",
  "src/routes/api/music/spotify/callback.ts",
])

const layer = (path) => path.split("/")[1]
const backendUnit = (path) => {
  const parts = path.split("/")
  if (parts[1] === "modules") return parts.slice(0, 3).join("/")
  if (parts[1] === "actions")
    return parts.slice(0, parts[2] === "auth" ? 3 : 4).join("/")
  return undefined
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", ".wrangler", ".tanstack"].includes(entry.name))
      return []
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? files(path)
      : /\.(?:[cm]?ts|tsx|mjs)$/.test(path)
        ? [path]
        : []
  })
}

function imports(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
  const result = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === "require") &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      result.push(node.arguments[0].text)
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      result.push(node.argument.literal.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

export function inspectToolsBoundaries(root) {
  const errors = []
  const manifests = Object.fromEntries(
    Object.entries(packages).map(([owner, directory]) => [
      owner,
      JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8")),
    ])
  )
  const byName = Object.fromEntries(
    Object.entries(manifests).map(([owner, manifest]) => [manifest.name, owner])
  )
  const ownerOf = (path) =>
    Object.entries(packages).find(([, directory]) =>
      path.startsWith(resolve(root, directory) + "/")
    )?.[0]
  for (const [owner, directory] of Object.entries(packages)) {
    const base = resolve(root, directory)
    for (const path of files(base)) {
      for (const specifier of imports(path)) {
        const fail = (message) =>
          errors.push(
            `${relative(root, path)} imports ${specifier}: ${message}`
          )
        const dependency = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]
        let targetOwner = byName[dependency]
        let target
        if (specifier.startsWith("."))
          target = resolve(dirname(path), specifier)
        else if (specifier.startsWith("#backend/")) {
          if (owner !== "backend") fail("backend aliases are private")
          target = resolve(root, packages.backend, "src", specifier.slice(9))
        } else if (specifier.startsWith("@/"))
          target = resolve(base, "src", specifier.slice(2))
        if (target) {
          targetOwner = ownerOf(target)
          if (targetOwner && targetOwner !== owner)
            fail("use the target package's public exports")
        }
        if (targetOwner && targetOwner !== owner && !target) {
          const subpath =
            specifier === dependency
              ? "."
              : "." + specifier.slice(dependency.length)
          if (!Object.hasOwn(manifests[targetOwner].exports ?? {}, subpath))
            fail("package subpath is private")
          if (!Object.hasOwn(manifests[owner].dependencies ?? {}, dependency))
            fail("declare the workspace dependency")
        }
        if (
          (owner === "backend" && ["web", "cli"].includes(targetOwner)) ||
          (owner === "contracts" &&
            ["web", "backend", "cli"].includes(targetOwner)) ||
          (owner === "cli" && ["web", "backend"].includes(targetOwner))
        )
          fail("dependency points into an application implementation")
        if (
          ["backend", "contracts"].includes(owner) &&
          /^(?:react(?:-dom)?(?:\/|$)|@tanstack\/)/.test(specifier)
        )
          fail("browser framework runtime is outside this package")
        if (
          owner === "contracts" &&
          relative(base, path).startsWith("src/") &&
          !target &&
          !["effect", "@orpc/client", "@orpc/contract"].includes(dependency)
        )
          fail("contracts depend only on Effect and oRPC contracts/client")
        if (owner === "web" && targetOwner === "backend") {
          const hostPath = relative(base, path)
          if (
            !hostEntries.has(hostPath) ||
            specifier !==
              `@mdoultremont/tools-backend/${hostPath === "src/server.ts" ? "worker" : "http"}`
          )
            fail(
              "only Worker composition and protocol/server-function adapters import the backend"
            )
        }
        if (owner === "backend" && targetOwner === "backend") {
          const sourcePath = relative(base, path)
          const targetPath = relative(base, target)
          if (
            (layer(sourcePath) === "modules" &&
              ["actions", "entrypoints"].includes(layer(targetPath))) ||
            (layer(sourcePath) === "actions" &&
              layer(targetPath) === "entrypoints")
          )
            fail(
              "backend imports point down from entrypoints to actions to modules"
            )
          const unit = backendUnit(targetPath)
          const imported = targetPath.replace(/(?:\/index)?\.ts$|\/index$/g, "")
          const testing =
            /\/modules\/(?:database|object-storage)\/testing$/.test(imported) &&
            /(?:\.test|\/testing)\.ts$/.test(sourcePath)
          if (
            unit &&
            unit !== backendUnit(sourcePath) &&
            imported !== unit &&
            !testing
          )
            fail("import backend units through their index.ts public API")
        }
        if (
          owner === "backend" &&
          relative(base, path).startsWith("src/actions/") &&
          specifier === "cloudflare:workers"
        )
          fail("actions receive platform services through Effect")
      }
    }
    for (const exported of Object.values(manifests[owner].exports ?? {})) {
      if (
        typeof exported !== "string" ||
        exported.includes("*") ||
        !exported.startsWith("./src/")
      )
        errors.push(`${directory}: use explicit source entrypoint exports`)
    }
  }
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = inspectToolsBoundaries(resolve(import.meta.dirname, ".."))
  if (errors.length) {
    process.stderr.write(errors.join("\n") + "\n")
    process.exitCode = 1
  } else process.stdout.write("Tools package boundaries passed.\n")
}
