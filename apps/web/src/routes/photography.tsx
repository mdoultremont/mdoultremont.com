import { Dialog } from "@base-ui/react/dialog"
import { createFileRoute } from "@tanstack/react-router"
import { useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import { useHotkey } from "@tanstack/react-hotkeys"
import { SiteShell } from "../components/site-shell"
import { photographs, photographyCopy } from "../content/photography"
import type { Photograph } from "../content/photography"
import { profile } from "../content/shared"
import { CopyEmailButton } from "../components/copy-email-button"
import { ResponsiveImage } from "../features/images/responsive-image"
import photographyMetadata from "virtual:photography-images"
import profileMetadata from "virtual:profile-images"

const galleryFallback =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23e8e6e0'/%3E%3C/svg%3E"

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
                  {photographyCopy.hero.eyebrow}
                </p>
                <h1 className="mt-4 max-w-[9ch] text-[clamp(4rem,9vw,9rem)] leading-[0.9] font-medium tracking-[-0.065em]">
                  {photographyCopy.hero.title}
                  <span className="text-accent">.</span>
                </h1>
                <p className="mt-8 max-w-xl text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.55] text-muted">
                  {photographyCopy.hero.introduction}
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
                  image={profileMetadata[profile.photographyPortrait]}
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
                  aria-label={`View photograph ${index + 1}${photographCaption(photo) ? `: ${photographCaption(photo)}` : ""}`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <ResponsiveImage
                    className="block w-full rounded-sm bg-[#e8e6e0] transition-opacity hover:opacity-95"
                    src={photo.src}
                    image={photographyMetadata[photo.src]}
                    widthRole="gallery"
                    sizes="(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw"
                    alt={photographAlt(photo)}
                    loading="lazy"
                    decoding="async"
                    onError={handleGalleryImageError}
                  />
                  {photographCaption(photo) && (
                    <span className="block py-3 text-sm text-muted">
                      {photographCaption(photo)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        </main>
      </SiteShell>
      {selectedPhoto && selectedIndex !== null && (
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-100 bg-[#111111ed]" />
          <Dialog.Viewport className="fixed inset-0 z-101 min-h-dvh overflow-hidden">
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
      className="fixed inset-0 h-dvh w-screen outline-none"
    >
      <Dialog.Close
        className="absolute top-4 right-4 z-10 grid size-11 cursor-pointer place-items-center rounded-full bg-charcoal/80 text-paper transition-colors hover:bg-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
        aria-label="Close photograph"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </Dialog.Close>
      <div className="absolute inset-x-16 top-16 bottom-16 flex items-center justify-center sm:inset-x-20">
        <ModalPhotograph key={photo.src} photo={photo} />
      </div>
      <button
        className="absolute top-1/2 left-3 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-charcoal/80 text-paper transition-colors hover:bg-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper sm:left-6"
        type="button"
        onClick={() => onNavigate(-1)}
        aria-label="Previous photograph"
        aria-keyshortcuts="ArrowLeft"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <Dialog.Title className="absolute right-16 bottom-5 left-16 truncate text-center text-sm font-medium text-paper sm:right-20 sm:left-20">
        {photographCaption(photo) && `${photographCaption(photo)} · `}
        {index + 1} of {photographs.length}
      </Dialog.Title>
      <button
        className="absolute top-1/2 right-3 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-charcoal/80 text-paper transition-colors hover:bg-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper sm:right-6"
        type="button"
        onClick={() => onNavigate(1)}
        aria-label="Next photograph"
        aria-keyshortcuts="ArrowRight"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </Dialog.Popup>
  )
}

function ModalPhotograph({ photo }: { photo: Photograph }) {
  const [retryCount, setRetryCount] = useState(0)
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">(
    "loading"
  )
  const image = photographyMetadata[photo.src]
  const requestKey = `${photo.src}:${retryCount}`

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {imageState === "loading" && (
        <output className="absolute inset-0 z-1 grid place-items-center text-sm text-paper/75">
          Loading photograph…
        </output>
      )}
      {imageState === "error" && (
        <div
          className="absolute inset-0 z-1 flex flex-col items-center justify-center gap-3 text-center text-sm text-paper"
          role="alert"
        >
          <p>Photograph unavailable.</p>
          <button
            className="rounded-full border border-paper/50 px-4 py-2 font-semibold hover:bg-white/10"
            type="button"
            onClick={() => {
              setImageState("loading")
              setRetryCount((count) => count + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}
      <ResponsiveImage
        key={requestKey}
        className={`absolute inset-0 block h-full w-full object-contain ${imageState === "error" ? "invisible" : ""}`}
        src={photo.src}
        image={image}
        widthRole="modal"
        sizes="min(75rem, 100vw)"
        alt={photographAlt(photo)}
        loading="eager"
        onLoad={(event) => {
          if (event.currentTarget.dataset.requestKey !== requestKey) return
          setImageState(
            event.currentTarget.naturalWidth === 1 &&
              event.currentTarget.naturalHeight === 1
              ? "error"
              : "loaded"
          )
        }}
        onError={(event) => {
          if (event.currentTarget.dataset.requestKey !== requestKey) return
          setImageState("error")
        }}
        data-request-key={requestKey}
      />
    </div>
  )
}

function handleGalleryImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (image.dataset.fallbackApplied) return
  image.dataset.fallbackApplied = "true"
  image.removeAttribute("srcset")
  image.alt = "Photograph unavailable"
  image.src = galleryFallback
}

function photographCaption(photo: Photograph) {
  return [photo.location, photo.year].filter(Boolean).join(", ")
}

function photographAlt(photo: Photograph) {
  const caption = photographCaption(photo)
  return caption ? `Photograph taken in ${caption}` : "Photograph by Matthieu"
}
