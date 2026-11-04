import { readdir, readFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
const dir = process.argv[2]
const files = await readdir(dir)
const rows = await Promise.all(
  files
    .filter((f) => /\.(js|css)$/.test(f))
    .sort()
    .map(async (file) => {
      const b = await readFile(`${dir}/${file}`)
      return { file, bytes: b.length, gzipBytes: gzipSync(b).length }
    })
)
console.log(
  JSON.stringify(
    {
      node: process.version,
      scope: "All emitted client JS/CSS assets, not initial transfer or timing",
      rows,
      totals: rows.reduce((s, r) => {
        const k = r.file.endsWith(".css") ? "css" : "js"
        s[k] = (s[k] || 0) + r.bytes
        return s
      }, {}),
    },
    null,
    2
  )
)
