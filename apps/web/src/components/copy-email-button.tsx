import { Toast } from "@base-ui/react/toast"
import type { ReactNode } from "react"
import { profile } from "../content"

type CopyEmailButtonProps = {
  children: ReactNode
  className: string
  ariaLabel?: string
}

export function CopyEmailButton({
  children,
  className,
  ariaLabel,
}: CopyEmailButtonProps) {
  const toastManager = Toast.useToastManager()

  const copyEmail = async () => {
    try {
      await copyText(profile.email)
      toastManager.add({ title: "Email copied", description: profile.email })
    } catch {
      toastManager.add({
        title: "Could not copy email",
        description: profile.email,
      })
    }
  }

  return (
    <button
      className={className}
      type="button"
      onClick={copyEmail}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.position = "fixed"
  textArea.style.opacity = "0"
  document.body.appendChild(textArea)
  textArea.select()

  const copied = document.execCommand("copy")
  textArea.remove()
  if (!copied) throw new Error("Copy failed")
}
