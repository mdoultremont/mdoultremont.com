import { z } from "zod"
import photographyPageData from "../../content/photography-page.json"
import photographsData from "../../content/photography.json"

const photographSchema = z.object({
  src: z.string().min(1),
  location: z.string().min(1).optional(),
  year: z.int().min(1000).max(9999).optional(),
})

const photographyContentSchema = z.object({
  page: z.object({
    hero: z.object({
      eyebrow: z.string().min(1),
      title: z.string().min(1),
      introduction: z.string().min(1),
    }),
  }),
  photographs: z.array(photographSchema),
})

export type Photograph = z.infer<typeof photographSchema>

export function createPhotographyContent(source: unknown) {
  const content = photographyContentSchema.parse(source)
  return {
    copy: content.page,
    photographs: content.photographs,
  }
}

export const { copy: photographyCopy, photographs } = createPhotographyContent({
  page: photographyPageData,
  photographs: photographsData,
})
