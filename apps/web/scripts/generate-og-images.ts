import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas"

const clientDirectory = "dist/client"
const width = 1200
const height = 630
const bandTop = 460
const fonts = "node_modules/@fontsource/inter/files"
GlobalFonts.registerFromPath(`${fonts}/inter-latin-500-normal.woff2`, "Inter")
GlobalFonts.registerFromPath(`${fonts}/inter-latin-600-normal.woff2`, "Inter")
const avatar = await loadImage("public/apple-touch-icon.png")

function renderImage(eyebrow: string, title: string, url: string) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#171717"
  ctx.fillRect(0, 0, width, height)

  const glow = ctx.createRadialGradient(990, 540, 0, 990, 540, 438)
  glow.addColorStop(0, "rgb(244 63 60 / 0.55)")
  glow.addColorStop(0.7, "rgb(244 63 60 / 0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = "#3c3c3c"
  ctx.fillRect(63, 0, 2, height)
  ctx.fillRect(width - 65, 0, 2, height)
  ctx.fillRect(63, bandTop - 1, width - 126, 2)

  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = "#f43f3c"
  ctx.beginPath()
  ctx.arc(127, 112, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = "500 26px Inter"
  ctx.letterSpacing = "0px"
  ctx.fillStyle = "#a3a3a3"
  ctx.fillText(eyebrow, 148, 121)

  let size = 88
  let lines: string[]
  do {
    ctx.font = `500 ${size}px Inter`
    ctx.letterSpacing = `${-0.04 * size}px`
    lines = []
    let line = ""
    for (const word of title.split(/\s+/)) {
      if (line && ctx.measureText(`${line} ${word}`).width > 900) {
        lines.push(line)
        line = ""
      }
      line += (line ? " " : "") + word
    }
    lines.push(line)
    if (
      lines.length * size * 1.04 <= 280 &&
      lines.every((part) => ctx.measureText(part).width <= 900)
    )
      break
    size *= 0.95
  } while (size > 0)
  ctx.fillStyle = "#ffffff"
  lines.forEach((line, index) =>
    ctx.fillText(line, 120, 155 + size * 0.86 + index * size * 1.04)
  )

  ctx.font = "600 30px Inter"
  ctx.letterSpacing = "-0.6px"
  ctx.fillText("Matthieu d'Oultremont", 120, 537)
  ctx.font = "500 24px Inter"
  ctx.letterSpacing = "0px"
  ctx.fillStyle = "#a3a3a3"
  ctx.fillText(url, 120, 572)

  ctx.drawImage(avatar, 880, 388, 180, 180)
  return canvas.toBuffer("image/png")
}

function attribute(tag: string, name: string) {
  const value = tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
  return value?.replaceAll(/&amp;|&#x26;|&#38;/g, "&")
}

function metaContent(html: string, property: string) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    if (attribute(tag, "property") === property)
      return attribute(tag, "content")
  }
}

async function generateImages(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) {
      await generateImages(file)
      continue
    }
    if (!entry.name.endsWith(".html")) continue
    const html = await readFile(file, "utf8")
    const image = metaContent(html, "og:image")
    if (!image) continue
    const imageUrl = new URL(image)
    const pageUrl = new URL(metaContent(html, "og:url")!)
    const eyebrow = imageUrl.searchParams.get("eyebrow")
    const title = imageUrl.searchParams.get("title")
    if (!eyebrow?.trim() || !title?.trim())
      throw new Error(`Missing og:image eyebrow or title in ${file}`)
    const output = join(clientDirectory, imageUrl.pathname)
    await mkdir(join(clientDirectory, "og"), { recursive: true })
    await writeFile(
      output,
      renderImage(
        eyebrow,
        title,
        `${pageUrl.host}${pageUrl.pathname.replace(/\/$/, "")}`
      )
    )
    console.log(`Generated ${output}`)
  }
}

await generateImages(clientDirectory)
