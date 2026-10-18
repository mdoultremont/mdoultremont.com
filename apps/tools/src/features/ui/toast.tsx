import { Toast } from "@base-ui/react/toast"
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"
import { cn } from "@/features/ui/lib/utils"

type ToastType = "success" | "error"

interface ToastOptions {
  readonly type?: ToastType
  /** A button shown after the message, such as "Undo". */
  readonly action?: {
    readonly label: string
    readonly onClick: () => void
  }
}

const toastManager = Toast.createToastManager()

/** Shows a short message at the bottom of the screen. Needs `<Toaster>` mounted once. */
function toast(
  message: string,
  { type = "success", action }: ToastOptions = {}
) {
  return toastManager.add({
    description: message,
    type,
    priority: type === "error" ? "high" : "low",
    actionProps: action
      ? { children: action.label, onClick: action.onClick }
      : undefined,
  })
}

/** Provides `toast()` to `children` and renders the toasts, bottom center. */
function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider limit={3} toastManager={toastManager}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed inset-x-4 bottom-4 z-50 flex flex-col-reverse items-center gap-2 outline-none sm:bottom-6">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((item) => (
    <Toast.Root
      className={cn(
        "flex w-fit max-w-sm items-start gap-2.5 rounded-xl bg-neutral-900 px-3.5 py-2.5 text-sm leading-5 text-neutral-50 shadow-lg ring-1 ring-white/10 select-none dark:bg-neutral-800",
        "translate-y-(--toast-swipe-movement-y) transition-[translate,opacity] duration-200 ease-out data-swiping:duration-0 motion-reduce:transition-opacity",
        "data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-limited:hidden"
      )}
      key={item.id}
      swipeDirection="down"
      toast={item}
    >
      {/* `mt-0.5` centers the 16px icon on the first 20px line of text. */}
      {item.type === "error" ? (
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
      ) : (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      )}
      {/* The action sits after a one-line message and wraps under a longer one. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
        <Toast.Description className="text-pretty" />
        {item.actionProps ? (
          <Toast.Action className="-mx-2 -my-1 shrink-0 rounded-md px-2 py-1 font-medium text-primary outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring" />
        ) : null}
      </div>
    </Toast.Root>
  ))
}

export { Toaster, toast }
