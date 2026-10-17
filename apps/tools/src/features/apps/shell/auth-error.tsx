import { useLocation } from "@tanstack/react-router"
import { CircleAlertIcon } from "lucide-react"
import { signInErrorMessage } from "@/features/auth/auth-client"
import { Alert, AlertDescription } from "@/features/ui/alert"

/** Explains a failed sign-in or account link after Better Auth redirects back with `?error=`. */
export function AuthError({ className }: { className?: string }) {
  const error = useSearchParam("error")
  if (!error) return null
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlertIcon />
      <AlertDescription>{signInErrorMessage(error)}</AlertDescription>
    </Alert>
  )
}

export const useSearchParam = (name: string) =>
  useLocation({
    select: (location) => new URLSearchParams(location.searchStr).get(name),
  })
