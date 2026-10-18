import { createRoot } from "react-dom/client"
import { UsersPanel } from "../../../src/features/back-office/users-panel"

export function mountUsersPanel(currentUserId: string) {
  const element = document.createElement("div")
  element.className = "p-8"
  document.body.appendChild(element)
  createRoot(element).render(<UsersPanel currentUserId={currentUserId} />)
}
