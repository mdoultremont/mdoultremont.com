import { z } from "zod"
import profileData from "../../content/profile.json"

const profileSchema = z.object({
  name: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email(),
  location: z.string().min(1),
  linkedin: z.url(),
  professionalPortrait: z.string().min(1),
  photographyPortrait: z.string().min(1),
  available: z.boolean(),
  availabilityLabel: z.string().min(1),
})

export type Profile = z.infer<typeof profileSchema>

export const profile = profileSchema.parse(profileData)
