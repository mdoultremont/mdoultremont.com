import { LockIcon } from "lucide-react"
import type { ReactNode } from "react"
import { portfolioUrl } from "@/features/apps/catalog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"

/** The centered card that signed-out and OAuth pages share. */
export function AuthFrame({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-heading font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LockIcon className="size-3.5" />
          </div>
          Private apps
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              <h1>{title}</h1>
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">{children}</CardContent>
        </Card>
        <a
          href={portfolioUrl}
          className="self-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Return to portfolio
        </a>
      </div>
    </div>
  )
}
