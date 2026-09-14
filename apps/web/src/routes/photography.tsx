import { Dialog } from "@base-ui/react/dialog"
import { createFileRoute } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useHotkey } from "@tanstack/react-hotkeys"
import { SiteShell } from "../components/site-shell"
import { pageCopy, photographs, profile } from "../content"
import type { Photograph } from "../content"
import { CopyEmailButton } from "../components/copy-email-button"
import { ResponsiveImage } from "../features/images/responsive-image"
import metadata from "virtual:portfolio-images"

export const Route = createFileRoute("/photography")({
  component: PhotographyPage,
})

function PhotographyPage() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const selectedPhoto =
    selectedIndex === null ? null : photographs[selectedIndex]

  const selectAdjacent = (direction: -1 | 1) => {
    setSelectedIndex((current) => {
      if (current === null) return null
      return (current + direction + photographs.length) % photographs.length
    })
  }

  return (
    <Dialog.Root
      open={selectedPhoto !== null}
      onOpenChange={(open) => !open && setSelectedIndex(null)}
    >
      <SiteShell>
        <main>
          <section className="border-b border-line">
            <div className="mx-auto grid w-[calc(100%-2rem)] max-w-[1440px] gap-12 border-x border-line sm:w-[calc(100%-4rem)] lg:w-[calc(100%-6rem)] lg:grid-cols-2 lg:items-stretch lg:gap-8">
              <div className="px-4 py-12 sm:px-6 sm:py-16 lg:py-24 lg:pl-8 lg:pr-0">
                <p className="text-[0.7rem] font-bold tracking-[0.12em] text-muted uppercase">
                  {pageCopy.photographyEyebrow}
                </p>
                <h1 className="mt-4 max-w-[9ch] text-[clamp(4rem,9vw,9rem)] leading-[0.9] font-medium tracking-[-0.065em]">
                  {pageCopy.photographyTitle}
                  <span className="text-accent">.</span>
                </h1>
                <p className="mt-8 max-w-xl text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.55] text-muted">
                  {pageCopy.photographyIntroduction}
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-5">
                  <CopyEmailButton className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-[#333]">
                    Get in touch
                  </CopyEmailButton>
                  <a
                    className="border-b border-current py-1 text-sm font-semibold transition-colors hover:text-accent-dark"
                    href="#collection"
                  >
                    See the collection
                  </a>
                </div>
              </div>
              <div className="relative self-stretch lg:overflow-hidden">
                <ResponsiveImage
                  className="mx-auto block w-full max-w-sm object-contain object-bottom lg:absolute lg:bottom-0 lg:left-1/2 lg:h-full lg:w-auto lg:max-w-full lg:-translate-x-1/2"
                  src={profile.photographyPortrait}
                  image={metadata[profile.photographyPortrait]}
                  alt="Matthieu holding an instant camera"
                />
              </div>
            </div>
          </section>
          <section
            className="border-b border-line"
            aria-label="Photography collection"
            id="collection"
          >
            <div className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] columns-1 gap-6 border-x border-line px-4 py-16 sm:w-[calc(100%-4rem)] sm:px-6 sm:py-20 md:columns-2 lg:w-[calc(100%-6rem)] lg:columns-3 lg:px-8 lg:py-24">
              {photographs.map((photo, index) => (
                <button
                  className="mb-8 inline-block w-full cursor-zoom-in break-inside-avoid bg-transparent text-left"
                  key={photo.src}
                  type="button"
                  aria-label={`View photograph ${index + 1}: ${photo.location} ${photo.year}`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <ResponsiveImage
                    className="block w-full rounded-sm transition-opacity hover:opacity-95"
                    src={photo.src}
                    image={metadata[photo.src]}
                    sizes="(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw"
                    alt={`Photograph taken in ${photo.location}, ${photo.year}`}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="block py-3 text-sm text-muted">
                    {photo.location} {photo.year}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </main>
      </SiteShell>
      {selectedPhoto && selectedIndex !== null && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-100 bg-[#111111d9] backdrop-blur-lg" />
          <Dialog.Viewport className="fixed inset-0 z-101 grid min-h-dvh place-items-center p-4">
            <PhotographDialog
              photo={selectedPhoto}
              index={selectedIndex}
              onNavigate={selectAdjacent}
            />
          </Dialog.Viewport>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}

function PhotographDialog({
  photo,
  index,
  onNavigate,
}: {
  photo: Photograph
  index: number
  onNavigate: (direction: -1 | 1) => void
}) {
  const popupRef = useRef<HTMLDivElement>(null)

  // Dialog stops arrow-key propagation; listen on the popup itself.
  // Mounting with the popup ensures its ref exists when hotkeys register.
  useHotkey("ArrowLeft", () => onNavigate(-1), { target: popupRef })
  useHotkey("ArrowRight", () => onNavigate(1), { target: popupRef })

  return (
    <Dialog.Popup
      ref={popupRef}
      className="relative w-fit max-w-[min(75rem,100%)] outline-none"
    >
      <Dialog.Close
        className="absolute top-4 right-4 min-h-11 cursor-pointer rounded-full border border-[#555] bg-charcoal px-4 py-2 text-xs font-semibold text-paper"
        aria-label="Close photograph"
      >
        Close
      </Dialog.Close>
      <ResponsiveImage
        className="block h-auto w-auto max-h-[calc(100dvh-6rem)] max-w-full rounded-xl object-contain"
        src={photo.src}
        image={metadata[photo.src]}
        sizes="min(75rem, 100vw)"
        alt={`Photograph taken in ${photo.location}, ${photo.year}`}
      />
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 pt-3 text-paper">
        <button
          className="min-h-11 rounded-full px-3 py-2 text-sm hover:bg-white/10"
          type="button"
          onClick={() => onNavigate(-1)}
          aria-label="Previous photograph"
          aria-keyshortcuts="ArrowLeft"
        >
          Previous
        </button>
        <Dialog.Title className="min-w-0 truncate text-center text-sm font-medium">
          {photo.location} {photo.year} · {index + 1} of {photographs.length}
        </Dialog.Title>
        <button
          className="min-h-11 rounded-full px-3 py-2 text-sm hover:bg-white/10"
          type="button"
          onClick={() => onNavigate(1)}
          aria-label="Next photograph"
          aria-keyshortcuts="ArrowRight"
        >
          Next
        </button>
      </div>
    </Dialog.Popup>
  )
}
