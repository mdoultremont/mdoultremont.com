import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "vitest"

import { readImageMetadata } from "./metadata.build"

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  )
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "portfolio-image-metadata-"))
  temporaryRoots.push(root)
  await mkdir(join(root, "content"), { recursive: true })
  await mkdir(join(root, "public/media/profile"), { recursive: true })
  await mkdir(join(root, "public/media/photography"), { recursive: true })
  await writeFile(join(root, "public/media/profile/avatar.png"), tinyPng)
  await writeFile(
    join(root, "content/profile.json"),
    JSON.stringify({ image: "/media/profile/avatar.png" })
  )
  await writeFile(join(root, "content/pages.json"), JSON.stringify({}))
  await writeFile(join(root, "content/photography.json"), JSON.stringify([]))
  return root
}

describe("portfolio image metadata", () => {
  test("reads real assets, tracks source changes, and rejects missing references", async () => {
    const realRoot = join(import.meta.dirname, "../../..")
    const realMetadata = await readImageMetadata({ root: realRoot })
    expect(realMetadata["/media/profile/matthieu-portrait.png"]).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
      version: expect.stringMatching(/^[a-f0-9]{16}$/),
    })

    const root = await createFixture()
    const first = await readImageMetadata({ root })
    expect(first["/media/profile/avatar.png"]).toMatchObject({
      width: 1,
      height: 1,
    })

    await writeFile(
      join(root, "public/media/profile/avatar.png"),
      Buffer.concat([tinyPng, Buffer.from([1])])
    )
    const second = await readImageMetadata({ root })
    expect(second["/media/profile/avatar.png"]?.version).not.toBe(
      first["/media/profile/avatar.png"]?.version
    )

    await writeFile(
      join(root, "content/profile.json"),
      JSON.stringify({ image: "/media/profile/missing.png" })
    )
    await expect(readImageMetadata({ root })).rejects.toThrow(
      "Missing referenced image: /media/profile/missing.png"
    )
  })
})
