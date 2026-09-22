import { z } from "zod"
import experiencesData from "../../content/experiences.json"
import professionalData from "../../content/professional.json"

const optionalDate = z
  .union([z.iso.date(), z.literal("")])
  .transform((value) => (value === "" ? undefined : value))

const experienceSchema = z
  .object({
    company: z.string().min(1),
    role: z.string().min(1),
    startDate: z.iso.date(),
    endDate: optionalDate,
    summary: z.string().min(1),
  })
  .refine(({ startDate, endDate }) => !endDate || endDate >= startDate, {
    path: ["endDate"],
    message: "must not be earlier than startDate",
  })
  .transform(({ startDate, endDate, ...experience }) => ({
    ...experience,
    period: formatPeriod(startDate, endDate),
  }))

const professionalContentSchema = z.object({
  page: z.object({
    hero: z.object({
      eyebrow: z.string().min(1),
      introduction: z.string().min(1),
    }),
    statement: z.string().min(1),
    experience: z.object({
      eyebrow: z.string().min(1),
      title: z.string().min(1),
      introduction: z.string().min(1),
    }),
    contact: z.object({
      eyebrow: z.string().min(1),
      title: z.string().min(1),
    }),
  }),
  experiences: z.array(experienceSchema),
})

export type Experience = z.infer<typeof experienceSchema>

export function createProfessionalContent(source: unknown) {
  const content = professionalContentSchema.parse(source)
  return {
    copy: content.page,
    experiences: content.experiences,
  }
}

function formatPeriod(startDate: string, endDate?: string) {
  const format = new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
  const start = format.format(new Date(`${startDate}T12:00:00Z`))
  return `${start} – ${endDate ? format.format(new Date(`${endDate}T12:00:00Z`)) : "Present"}`
}

export const { copy: professionalCopy, experiences } =
  createProfessionalContent({
    page: professionalData,
    experiences: experiencesData,
  })
