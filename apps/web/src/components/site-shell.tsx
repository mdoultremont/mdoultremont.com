import { Toast } from "@base-ui/react/toast"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { profile } from "../content/shared"
import { CopyEmailButton } from "./copy-email-button"
import { FaceAnimation } from "./face-animation"

const navigation = [
  { to: "/", label: "Professional" },
  { to: "/photography", label: "Photography" },
] as const

export function SiteShell({
  children,
  contactTitle,
}: {
  children: ReactNode
  contactTitle?: string
}) {
  return (
    <Toast.Provider timeout={3200}>
      <div className="overflow-clip bg-paper text-ink">
        <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-xl">
          <div className="mx-auto grid min-h-20 w-[calc(100%-2rem)] max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center gap-4 border-x border-line px-4 sm:w-[calc(100%-4rem)] sm:px-6 lg:w-[calc(100%-6rem)] lg:px-8">
            <Link
              className="inline-flex size-11 items-center justify-center rounded-xl"
              to="/"
              aria-label={`${profile.name}, home`}
            >
              <FaceAnimation
                className="block size-10 shrink-0"
                withHover
                withIdle
              />
            </Link>
            <nav
              className="flex items-center justify-center"
              aria-label="Portfolio sections"
            >
              {navigation.map((item) => (
                <Link
                  className="group relative inline-flex min-h-11 items-center justify-center px-3 py-2 text-xs font-medium text-muted hover:text-ink"
                  key={item.to}
                  to={item.to}
                  viewTransition
                  activeOptions={{ exact: true }}
                  activeProps={{
                    className: "text-ink nav-active",
                  }}
                >
                  {item.label}
                  <span
                    className="pointer-events-none absolute right-2.5 bottom-[7px] left-2.5 hidden h-px bg-[linear-gradient(90deg,transparent,#666_12%,#666_88%,transparent)] group-[.nav-active]:block group-[.nav-active]:[view-transition-name:portfolio-underline]"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </nav>
            <CopyEmailButton
              className="hidden min-h-[46px] cursor-pointer items-center justify-center justify-self-end rounded-full border border-[#181818] bg-linear-to-b from-[#353535] to-[#141414] px-[1.4rem] py-[0.7rem] text-[0.9rem] font-medium text-white shadow-[inset_0_1px_1px_#ffffff4d,inset_0_-1px_1px_#000,0_2px_3px_#00000024] transition-[transform,box-shadow,filter] duration-150 hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_3px_#0006,0_1px_1px_#0002] sm:inline-flex"
              ariaLabel="Get in touch by copying email address"
            >
              Get in touch
            </CopyEmailButton>
          </div>
        </header>
        {children}
        <footer className="relative isolate [background:radial-gradient(ellipse_at_75%_125%,rgb(142_172_203_/_55%),transparent_60%),radial-gradient(ellipse_at_20%_130%,rgb(223_154_140_/_55%),transparent_60%),#f8f7f4] after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[url('/media/brand/grain.svg')] after:opacity-[0.045]">
          <div className="mx-auto grid w-[calc(100%-2rem)] max-w-[1440px] gap-8 border-x border-line px-4 py-12 sm:w-[calc(100%-4rem)] sm:px-6 lg:w-[calc(100%-6rem)] lg:grid-cols-12 lg:gap-x-8 lg:gap-y-8 lg:px-8 lg:py-16">
            {contactTitle && (
              <h2 className="max-w-[17ch] text-[clamp(2.25rem,4.3vw,4rem)] leading-[1.05] font-medium tracking-[-0.04em] text-pretty lg:col-span-6 lg:col-start-7 lg:row-start-1">
                {contactTitle}
              </h2>
            )}
            <div className="lg:col-span-6 lg:col-start-1 lg:row-start-1">
              <p className="m-0 text-[0.8rem] leading-6 font-medium text-muted">
                Say hello
              </p>
              <CopyEmailButton
                className="mt-0 block max-w-full cursor-pointer wrap-anywhere py-2 text-left text-[clamp(1.35rem,2.6vw,2.75rem)] leading-[1.2] tracking-[-0.035em] text-pretty underline decoration-ink/20 decoration-px underline-offset-[0.2em] hover:decoration-current"
                ariaLabel="Get in touch by copying email address"
              >
                {profile.email}
              </CopyEmailButton>
              <p className="mt-2 text-[0.8rem] text-muted">
                Click to copy address
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-6 text-pretty text-sm text-muted lg:col-span-6 lg:col-start-1 lg:row-start-2 lg:self-end">
              <a
                className="inline-flex min-h-11 items-center text-sm font-medium underline decoration-ink/25 underline-offset-[0.35em] hover:text-accent-dark hover:decoration-current"
                href={profile.linkedin}
                rel="noreferrer"
                target="_blank"
              >
                LinkedIn
              </a>
              <span>{profile.location}</span>
            </div>
          </div>
        </footer>
      </div>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-5 bottom-5 z-200 w-[min(360px,calc(100vw-2.5rem))]" />
      </Toast.Portal>
      <ToastList />
    </Toast.Provider>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()

  return toasts.map((toast) => (
    <Toast.Root
      className="fixed right-5 bottom-5 z-200 w-[min(360px,calc(100vw-2.5rem))] rounded-xl border border-[#555] bg-charcoal p-4 text-paper shadow-2xl"
      key={toast.id}
      toast={toast}
    >
      <Toast.Content className="grid grid-cols-[1fr_auto] items-center gap-4">
        <div>
          <Toast.Title className="m-0 text-sm font-semibold" />
          <Toast.Description className="mt-1 text-xs text-white/60" />
        </div>
        <Toast.Close className="cursor-pointer rounded-full border border-[#555] px-3 py-1.5 text-xs text-paper hover:bg-white/10">
          Close
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ))
}
