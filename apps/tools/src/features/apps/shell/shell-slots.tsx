import { createContext, useContext, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

type Slot = "nav" | "footer" | "actions"
type Slots = Record<Slot, HTMLElement | null>

const empty: Slots = { nav: null, footer: null, actions: null }
const SlotsContext = createContext<Slots>(empty)
const SetSlotContext = createContext<
  (slot: Slot) => (element: HTMLElement | null) => void
>(() => () => {})

/**
 * Lets the current page render into the shell's sidebar and header while
 * keeping its own React context, such as the music player, because portals
 * keep the tree they are declared in.
 */
export function ShellSlotsProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>(empty)
  const [setters] = useState(() => {
    const setter = (slot: Slot) => (element: HTMLElement | null) =>
      setSlots((current) => ({ ...current, [slot]: element }))
    return {
      nav: setter("nav"),
      footer: setter("footer"),
      actions: setter("actions"),
    } satisfies Record<Slot, (element: HTMLElement | null) => void>
  })
  return (
    <SetSlotContext value={(slot) => setters[slot]}>
      <SlotsContext value={slots}>{children}</SlotsContext>
    </SetSlotContext>
  )
}

/** Where the shell places page content in its sidebar or header. */
export function ShellSlotTarget({
  slot,
  className = "contents",
}: {
  slot: Slot
  className?: string
}) {
  const setSlot = useContext(SetSlotContext)
  return <div ref={setSlot(slot)} className={className} />
}

/** Renders `children` in the shell's sidebar or header when it is on screen. */
export function ShellSlot({
  slot,
  children,
}: {
  slot: Slot
  children: ReactNode
}) {
  const element = useContext(SlotsContext)[slot]
  return element ? createPortal(children, element) : null
}
