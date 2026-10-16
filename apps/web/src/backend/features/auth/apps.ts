import { Schema } from "effect"

/** The private apps under /apps. A user may use an app only with access to it. */
export const apps = ["music", "backOffice"] as const

export type App = (typeof apps)[number]

export const AppSchema = Schema.Literals(apps)

export const isApp = (value: string): value is App =>
  (apps as ReadonlyArray<string>).includes(value)
