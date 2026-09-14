import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import sizeOf from "image-size"

import type { ImageMetadata } from "./images.ts"
type Options = { root: string }

const imagePattern = /\.(?:png|jpe?g|webp)$/i

export async function readImageMetadata({ root }: Options) {
  const result: Record<string, ImageMetadata> = {}
  for (const directory of [
    "public/media/profile",
    "public/media/photography",
    "public/media/brand/face",
  ]) {
    await collect(join(root, directory), root, result)
  }
  await validateContentReferences(root, result)
  return result
}

async function collect(
  directory: string,
  root: string,
  result: Record<string, ImageMetadata>
) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path, root, result)
    else if (imagePattern.test(entry.name)) {
      const bytes = await readFile(path)
      const dimensions = sizeOf(bytes)
      let { width, height } = dimensions
      if (dimensions.orientation && dimensions.orientation >= 5)
        [width, height] = [height, width]
      const publicPath =
        "/" + relative(join(root, "public"), path).replaceAll("\\", "/")
      result[publicPath] = {
        width,
        height,
        version: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      }
    }
  }
}

async function validateContentReferences(
  root: string,
  metadata: Record<string, ImageMetadata>
) {
  for (const file of [
    "content/profile.json",
    "content/pages.json",
    "content/photography.json",
  ]) {
    let text: string
    try {
      text = await readFile(join(root, file), "utf8")
    } catch {
      continue
    }
    for (const match of text.matchAll(
      /"(\/media\/(?:profile|photography)\/[^"?]+)"/g
    )) {
      if (!metadata[match[1]])
        throw new Error(`Missing referenced image: ${match[1]}`)
    }
  }
}
