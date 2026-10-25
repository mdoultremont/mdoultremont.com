import { createContext, useContext, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

type Slot = "nav" | "footer"
type Slots = Record<Slot, HTMLElement | null>

const SlotsContext = createContext<Slots>({ nav: null, footer: null })
const SetSlotContext = createContext<
  (slot: Slot) => (element: HTMLElement | null) => void
>(() => () => {})

/**
 * Lets the current app render into the shell's sidebar while keeping its own
 * React context, such as the music player, because portals keep the tree they
 * are declared in.
 */
export function SidebarSlotsProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ nav: null, footer: null })
  const [setters] = useState(
    () =>
      ({
        nav: (element: HTMLElement | null) =>
          setSlots((current) => ({ ...current, nav: element })),
        footer: (element: HTMLElement | null) =>
          setSlots((current) => ({ ...current, footer: element })),
      }) satisfies Record<Slot, (element: HTMLElement | null) => void>
  )
  return (
    <SetSlotContext value={(slot) => setters[slot]}>
      <SlotsContext value={slots}>{children}</SlotsContext>
    </SetSlotContext>
  )
}

/** Where the shell places app content in its sidebar. */
export function SidebarSlotTarget({ slot }: { slot: Slot }) {
  const setSlot = useContext(SetSlotContext)
  return <div ref={setSlot(slot)} className="contents" />
}

/** Renders `children` in the shell sidebar when it is on screen. */
export function SidebarSlot({
  slot,
  children,
}: {
  slot: Slot
  children: ReactNode
}) {
  const element = useContext(SlotsContext)[slot]
  return element ? createPortal(children, element) : null
}
