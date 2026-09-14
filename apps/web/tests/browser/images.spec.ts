import sizeOf from "image-size"
import { expect, test } from "@playwright/test"

test("decodes a responsive image transformed by the Images binding", async ({
  page,
  request,
}) => {
  await page.goto("/")
  const image = page.locator('img[src*="/images/media/profile/"]').first()
  const srcSet = await image.getAttribute("srcset")
  const source = srcSet
    ?.split(",")
    .map((candidate) => candidate.trim().split(" ")[0])
    .find((candidate) => candidate.includes("width=640"))

  expect(source).toBeTruthy()
  const response = await request.get(source!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toBe("image/webp")
  expect(sizeOf(await response.body())).toMatchObject({
    type: "webp",
    width: 640,
    height: 960,
  })
})

test("decodes a transformed face sprite without changing its frame ratio", async ({
  page,
}) => {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/images/media/brand/face/idle.png") &&
      new URL(response.url()).searchParams.get("width") === "360" &&
      response.status() === 200
  )
  await page.goto("/")
  const response = await responsePromise
  expect(response.headers()["content-type"]).toBe("image/webp")
  expect(sizeOf(await response.body())).toMatchObject({
    type: "webp",
    width: 360,
    height: 40,
  })
})

test("rejects unknown image versions and widths", async ({ page, request }) => {
  await page.goto("/")
  const image = page.locator('img[src*="/images/media/profile/"]').first()
  const source = await image.getAttribute("src")
  expect(source).toBeTruthy()
  const unknownVersion = await request.get(
    source!.replace(/v=[^&]+/, "v=unknown")
  )
  expect(unknownVersion.status()).toBe(404)

  const unknownWidth = await request.get(
    source!.replace(/width=\d+/, "width=641")
  )
  expect(unknownWidth.status()).toBe(404)
})

test("the image server route handles HEAD and rejects writes", async ({
  page,
  request,
}) => {
  await page.goto("/")
  const source = await page
    .locator('img[src*="/images/media/profile/"]')
    .first()
    .getAttribute("src")
  expect(source).toBeTruthy()
  const head = await request.head(source!)
  expect(head.status()).toBe(200)
  expect(head.headers()["content-type"]).toBe("image/webp")
  expect(await head.body()).toHaveLength(0)
  const post = await request.post(source!)
  expect(post.status()).toBe(405)
  expect(post.headers()["allow"]).toBe("GET, HEAD")
})
