import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { SiteShell } from "../components/site-shell"
import { CopyEmailButton } from "../components/copy-email-button"
import { experiences, pageCopy, profile } from "../content"
import { ResponsiveImage } from "../features/images/responsive-image"
import metadata from "virtual:portfolio-images"

export const Route = createFileRoute("/iterations")({
  head: () => ({
    meta: [
      { title: "Design iterations · Matthieu" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: IterationsPage,
})

const companyVisuals: Record<
  string,
  { color: string; portrait: string; icon: string }
> = {
  Atlassian: {
    color: "#3c77ff",
    portrait: "atlassian",
    icon: "atlassian.svg",
  },
  Cycle: { color: "#6566ed", portrait: "cycle", icon: "cycle.png" },
  Kiosk: { color: "#547eff", portrait: "kiosk", icon: "kiosk.png" },
  Smovin: { color: "#438ebd", portrait: "smovin", icon: "smovin.png" },
}

function Choices({
  label,
  values,
  value,
  onChange,
}: {
  label: string
  values: string[]
  value: number
  onChange: (index: number) => void
}) {
  return (
    <fieldset className="my-5 min-w-0 border-0">
      <legend className="mb-2 text-[0.8rem] text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {values.map((name, index) => (
          <button
            type="button"
            key={name}
            aria-pressed={index === value}
            className="min-h-11 cursor-pointer rounded-[7px] border border-ink/12 px-3.5 py-2.5 text-[0.8rem] aria-pressed:border-[#272727] aria-pressed:bg-[#272727] aria-pressed:text-white"
            onClick={() => onChange(index)}
          >
            {name}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
function Experiment({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="mb-20 scroll-mt-[110px]" id={id}>
      <div className="mb-7">
        <h2 className="mb-2 text-[1.7rem] font-medium tracking-[-0.03em]">
          {title}
        </h2>
        <p className="max-w-[70ch] text-base leading-[1.6] text-pretty text-muted">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}
function NavigationSample({ mode }: { mode: number }) {
  const [active, setActive] = useState(0)
  return (
    <div
      className="relative grid w-[264px] max-w-full grid-cols-2 pb-[5px]"
      style={{ "--active": active } as CSSProperties}
      aria-label="Navigation style preview"
    >
      {["Professional", "Photography"].map((name, index) => (
        <button
          key={name}
          type="button"
          className="min-h-11 cursor-pointer text-[0.85rem] text-muted aria-pressed:text-ink"
          aria-pressed={active === index}
          onClick={() => setActive(index)}
        >
          {name}
        </button>
      ))}
      <span
        className="pointer-events-none absolute bottom-0 left-0 h-px w-1/2 transition-transform duration-320 ease-[cubic-bezier(0.22,1,0.36,1)] [transform:translateX(calc(var(--active)*100%))]"
        aria-hidden="true"
      >
        <span
          className={`mx-[18px] block h-full ${mode === 0 ? "bg-ink" : mode === 1 ? "mx-6 mb-[10px] bg-[linear-gradient(90deg,transparent,#666_12%,#666_88%,transparent)]" : "mx-7 bg-accent-dark"}`}
        />
      </span>
    </div>
  )
}
function AvailabilitySample({ mode }: { mode: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2.5 rounded-full border border-[#d8d7d3] px-3.5 py-2 text-[0.8rem] whitespace-nowrap text-[#625f59] ${
        [
          "bg-linear-to-b from-white to-[#eeede9] shadow-[inset_0_1px_1px_#fff,inset_0_-1px_1px_#00000008,0_2px_3px_#00000006]",
          "border-[#dbdad5] bg-linear-to-b from-[#eae9e5] to-[#ffffffb3] shadow-[inset_0_1px_3px_#00000010,0_1px_0_#fff]",
          "border-[3px] border-[#e8e7e3] bg-[linear-gradient(150deg,#fff,#f3f2ee)] shadow-[0_1px_2px_#0000000d,inset_0_1px_1px_#fff,0_-1px_0_#fff]",
        ][mode]
      }`}
    >
      <span
        aria-hidden="true"
        className="size-[7px] rounded-full bg-[radial-gradient(circle_at_35%_25%,#75b58e,#30734d_80%)] shadow-[0_0_0_2px_#39825a0a]"
      />
      {profile.availabilityLabel}
    </span>
  )
}
function ButtonSample({ mode }: { mode: number }) {
  return (
    <CopyEmailButton
      className={`inline-flex min-h-[46px] cursor-pointer items-center justify-center rounded-full border border-[#181818] px-[1.4rem] py-[0.7rem] text-[0.9rem] font-medium text-white transition-[transform,box-shadow,filter] duration-150 hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_3px_#0006,0_1px_1px_#0002] ${
        [
          "bg-linear-to-b from-[#353535] to-[#141414] shadow-[inset_0_1px_1px_#ffffff4d,inset_0_-1px_1px_#000,0_2px_3px_#00000024]",
          "border-[3px] border-[#3c3c3c] bg-linear-to-b from-[#363636] to-[#111] shadow-[inset_0_1px_1px_#ffffff40,inset_0_-1px_1px_#000,0_1px_0_#111,0_3px_5px_#00000026]",
          "bg-[radial-gradient(ellipse_at_50%_0%,#505050,#1c1c1c_75%)] shadow-[inset_0_1px_1px_#ffffff80,inset_0_-2px_2px_#000,0_3px_4px_#00000020]",
        ][mode]
      }`}
    >
      Get in touch
    </CopyEmailButton>
  )
}

function IterationsPage() {
  const [hero, setHero] = useState(0)
  const [grain, setGrain] = useState(12)
  const [statement, setStatement] = useState(0)
  const [heading, setHeading] = useState(0)
  const [cards, setCards] = useState(2)
  const [iconSet, setIconSet] = useState(1)
  const [button, setButton] = useState(0)
  const [availability, setAvailability] = useState(0)
  const [navigation, setNavigation] = useState(1)
  const [copiedSummary, setCopiedSummary] = useState("")
  const [copyFailed, setCopyFailed] = useState(false)
  const summary = `Navigation ${navigation + 1}; availability ${availability + 1}; button ${button + 1}; hero ${hero + 1}; grain ${grain}%; statement ${statement + 1}; experience heading ${heading + 1}; cards ${cards + 1}; icons ${iconSet === 0 ? "LinkedIn logos" : "App icons"}; logos untextured.`
  async function copySelection() {
    try {
      await navigator.clipboard.writeText(summary)
      setCopiedSummary(summary)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
    }
  }
  return (
    <SiteShell>
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-16">
        <header className="mb-20 max-w-[780px]">
          <p className="m-0 text-[0.8rem] leading-6 font-medium text-muted">
            Design workbench
          </p>
          <h1 className="my-4 mb-6 text-[clamp(2.8rem,5vw,5rem)] leading-[1.04] font-medium tracking-[-0.05em]">
            Small details.
            <br />
            Different directions.
          </h1>
          <p className="max-w-[70ch] text-base leading-[1.6] text-pretty text-muted">
            Compare the treatments below. These experiments leave the
            professional and photography pages as they are.
          </p>
          <nav
            className="mt-6 flex flex-wrap gap-x-6 gap-y-2"
            aria-label="Experiments"
          >
            {[
              ["controls", "Navigation & controls"],
              ["hero", "Hero light"],
              ["statement", "Personal statement"],
              ["experience", "Experience"],
            ].map(([id, label]) => (
              <a
                className="py-2 text-sm underline underline-offset-[5px]"
                href={`#${id}`}
                key={id}
              >
                {label}
              </a>
            ))}
            <Link
              className="py-2 text-sm underline underline-offset-[5px]"
              to="/"
            >
              Current site
            </Link>
          </nav>
        </header>
        <Experiment
          id="controls"
          title="Navigation & controls"
          description="Click between sections to feel the underline move. Try the buttons to compare their pressed states; they copy the real email address."
        >
          <div className="mt-8 grid border border-ink/12 lg:grid-cols-3">
            {[0, 1, 2].map((mode) => (
              <div
                className="flex min-h-[170px] flex-col items-center justify-between gap-8 bg-[radial-gradient(ellipse_at_50%_0%,#fff8,transparent_75%)] p-6 not-first:border-l not-first:border-ink/12 max-lg:not-first:border-t max-lg:not-first:border-l-0 max-lg:min-h-[140px]"
                key={mode}
              >
                <p className="self-start text-[0.8rem] text-muted">
                  {
                    [
                      "1 · Fine sliding line",
                      "2 · Short soft line",
                      "3 · Quiet accent",
                    ][mode]
                  }
                </p>
                <NavigationSample mode={mode} />
              </div>
            ))}
          </div>
          <Choices
            label="Navigation choice"
            values={["1 · Fine", "2 · Short", "3 · Accent"]}
            value={navigation}
            onChange={setNavigation}
          />
          <div className="mt-8 grid border border-ink/12 lg:grid-cols-3">
            {[0, 1, 2].map((mode) => (
              <div
                className="flex min-h-[170px] flex-col items-center justify-between gap-8 bg-[radial-gradient(ellipse_at_50%_0%,#fff8,transparent_75%)] p-6 not-first:border-l not-first:border-ink/12 max-lg:not-first:border-t max-lg:not-first:border-l-0 max-lg:min-h-[140px]"
                key={mode}
              >
                <p className="self-start text-[0.8rem] text-muted">
                  {
                    [
                      "1 · Soft enamel",
                      "2 · Inset glass",
                      "3 · Porcelain edge",
                    ][mode]
                  }
                </p>
                <AvailabilitySample mode={mode} />
              </div>
            ))}
          </div>
          <Choices
            label="Availability choice"
            values={["1 · Enamel", "2 · Glass", "3 · Porcelain"]}
            value={availability}
            onChange={setAvailability}
          />
          <div className="mt-8 grid border border-ink/12 lg:grid-cols-3">
            {[0, 1, 2].map((mode) => (
              <div
                className="flex min-h-[170px] flex-col items-center justify-between gap-8 bg-[radial-gradient(ellipse_at_50%_0%,#fff8,transparent_75%)] p-6 not-first:border-l not-first:border-ink/12 max-lg:not-first:border-t max-lg:not-first:border-l-0 max-lg:min-h-[140px]"
                key={mode}
              >
                <p className="self-start text-[0.8rem] text-muted">
                  {["1 · Soft bevel", "2 · Raised rim", "3 · Satin dome"][mode]}
                </p>
                <ButtonSample mode={mode} />
              </div>
            ))}
          </div>
          <Choices
            label="Button choice"
            values={["1 · Bevel", "2 · Rim", "3 · Dome"]}
            value={button}
            onChange={setButton}
          />
        </Experiment>
        <Experiment
          id="hero"
          title="Light across the whole hero"
          description="Color and visible grain connect the copy and portrait without a middle divider. Your selected badge and button appear here together."
        >
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Choices
              label="Lighting"
              values={[
                "1 · Blue & peach",
                "2 · Lavender haze",
                "3 · Cool daylight",
              ]}
              value={hero}
              onChange={setHero}
            />
            <label className="grid min-w-[180px] grid-cols-[1fr_auto] gap-2.5 text-[0.8rem]">
              Background grain <output>{grain}%</output>
              <input
                className="col-span-full min-h-6 w-full accent-[#333]"
                type="range"
                min="0"
                max="30"
                value={grain}
                onChange={(e) => setGrain(Number(e.target.value))}
              />
            </label>
          </div>
          <div
            className={`relative isolate grid overflow-hidden border border-ink/12 max-sm:grid-cols-1 sm:grid-cols-2 after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[url('/media/brand/hero-grain.svg')] after:opacity-[var(--grain)] after:mix-blend-multiply ${
              [
                "[background:radial-gradient(ellipse_at_90%_20%,#a2badc55,transparent_65%),radial-gradient(ellipse_at_30%_115%,#e7a98c66,transparent_75%),#f8f7f4]",
                "[background:radial-gradient(ellipse_at_65%_30%,#b5a2cf55,transparent_70%),radial-gradient(ellipse_at_0%_110%,#e4b5a366,transparent_70%),#f8f7f4]",
                "[background:radial-gradient(ellipse_at_50%_120%,#9abfd877,transparent_75%),radial-gradient(ellipse_at_15%_15%,#bec9ad33,transparent_70%),#f8f7f4]",
              ][hero]
            }`}
            style={{ "--grain": grain / 100 } as CSSProperties}
          >
            <div className="p-[clamp(1.5rem,3vw,3rem)]">
              <AvailabilitySample mode={availability} />
              <p className="mt-8 text-[0.8rem] leading-6 font-medium text-muted">
                {profile.professionalEyebrow}
              </p>
              <h2 className="mt-4 text-[clamp(3.5rem,7.5vw,7.5rem)] leading-none font-medium tracking-[-0.055em]">
                {profile.firstName}
                <span className="text-accent">.</span>
              </h2>
              <p className="mt-6 max-w-[48ch] text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.65] text-pretty text-muted">
                {profile.professionalIntroduction}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <ButtonSample mode={button} />
                <a
                  className="relative inline-flex min-h-11 items-center text-sm font-medium after:pointer-events-none after:absolute after:-right-1 after:bottom-2 after:-left-1 after:h-px after:bg-[linear-gradient(90deg,transparent,#666_12%,#666_88%,transparent)] hover:after:bg-[linear-gradient(90deg,transparent,#121212_12%,#121212_88%,transparent)]"
                  href="#experience"
                >
                  See my experience
                </a>
              </div>
            </div>
            <div className="flex min-w-0 items-end justify-center">
              <ResponsiveImage
                className="max-h-[540px] max-w-full object-contain object-bottom max-sm:max-h-[330px]"
                src={profile.professionalPortrait}
                image={metadata[profile.professionalPortrait]}
                alt="Matthieu d'Oultremont"
              />
            </div>
          </div>
        </Experiment>
        <Experiment
          id="statement"
          title="Let the sentences breathe"
          description="Compare balanced centering, a narrower left alignment, and one thought per line. Each uses the same words."
        >
          <Choices
            label="Statement layout"
            values={[
              "1 · Centered balance",
              "2 · Left, balanced",
              "3 · Three thoughts",
            ]}
            value={statement}
            onChange={setStatement}
          />
          <div className="border border-ink/12 px-4 py-8 sm:p-[clamp(2rem,5vw,5rem)]">
            {statement === 2 ? (
              <p className="mx-auto max-w-[40ch] text-[clamp(1.8rem,3.4vw,3.25rem)] leading-[1.2] font-medium tracking-[-0.035em] text-balance [&>span]:block">
                {[
                  "Software is my profession.",
                  "Photography trains my eye.",
                  "Flying keeps the ego in check.",
                ].map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
            ) : (
              <p
                className={`text-[clamp(1.8rem,3.4vw,3.25rem)] leading-[1.2] font-medium tracking-[-0.035em] text-balance ${statement === 0 ? "mx-auto max-w-[36ch] text-center" : "max-w-[30ch]"}`}
              >
                {pageCopy.professionalStatement}
              </p>
            )}
          </div>
        </Experiment>
        <Experiment
          id="experience"
          title="Experience, with a little more character"
          description="No redundant eyebrow. Compare the introduction, then the company colors and smaller corner logos. The card lines sit on the frame, with a single shared line between cells."
        >
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Choices
              label="Introduction"
              values={["1 · Personal note", "2 · Editorial", "3 · Title only"]}
              value={heading}
              onChange={setHeading}
            />
            <Choices
              label="Card treatment"
              values={[
                "1 · Colored light",
                "2 · Colored field",
                "3 · Quiet monochrome",
              ]}
              value={cards}
              onChange={setCards}
            />
            <Choices
              label="Company icons"
              values={["1 · LinkedIn logos", "2 · App icons"]}
              value={iconSet}
              onChange={setIconSet}
            />
          </div>
          <div
            className="border border-white/15 bg-[#17191d] text-paper"
            style={
              {
                "--grain": grain / 100,
              } as CSSProperties
            }
          >
            <div
              className={`grid items-center gap-12 p-[clamp(1.5rem,3vw,3rem)] max-sm:grid-cols-1 max-sm:gap-6 ${heading === 2 ? "grid-cols-1" : "grid-cols-2"} ${heading === 1 ? "items-end" : ""}`}
            >
              <h2
                className={`max-w-[18ch] text-[clamp(2.25rem,4vw,4rem)] leading-[1.08] font-medium tracking-[-0.04em] text-balance ${heading === 2 ? "max-w-[26ch]" : ""}`}
              >
                {pageCopy.experienceTitle}
              </h2>
              {heading !== 2 && (
                <p
                  className={`max-w-[42ch] leading-[1.65] text-pretty text-[#c6c8ce] ${heading === 0 ? "border-l border-white/20 pl-6 text-[clamp(1.1rem,1.8vw,1.5rem)]" : ""}`}
                >
                  {heading === 0
                    ? "I care about the details, the people using them, and the people building them."
                    : pageCopy.experienceIntroduction}
                </p>
              )}
            </div>
            <div className="-mx-px grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              {experiences.map((experience) => {
                const visual = companyVisuals[experience.company]

                return (
                  <article
                    className={`relative isolate p-7 before:pointer-events-none before:absolute before:inset-0 before:border-t before:border-l before:border-white/12 after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[url('/media/brand/grain.svg')] after:opacity-[var(--grain)] after:mix-blend-soft-light last:before:border-r sm:nth-[2n]:before:border-r xl:nth-[2n]:before:border-r-0 ${
                      [
                        "bg-[radial-gradient(ellipse_at_5%_0%,color-mix(in_srgb,var(--company-color)_22%,transparent),transparent_75%)]",
                        "bg-[linear-gradient(145deg,color-mix(in_srgb,var(--company-color)_25%,#17191d),#17191d)]",
                        "bg-[linear-gradient(135deg,#34373b_0%,#25282c_42%,#17191d_90%)]",
                      ][cards]
                    }`}
                    key={experience.company}
                    style={
                      {
                        "--company-color": visual?.color ?? "#6f7b8b",
                      } as CSSProperties
                    }
                  >
                    <div className="flex min-h-9 items-center justify-between gap-4">
                      <p className="text-[0.8rem] text-[#b9bcc2]">
                        {experience.period}
                      </p>
                      <div
                        className={
                          iconSet === 1
                            ? "size-7 shrink-0"
                            : "size-7 shrink-0 overflow-hidden rounded-md"
                        }
                      >
                        {visual && (
                          <img
                            src={
                              iconSet === 0
                                ? `/media/companies/${visual.portrait}.jpg`
                                : `/media/companies/icons/${visual.icon}`
                            }
                            className={
                              iconSet === 1
                                ? "size-full object-contain"
                                : "size-full"
                            }
                            alt=""
                            width="28"
                            height="28"
                          />
                        )}
                      </div>
                    </div>
                    <h3 className="mt-6 text-[clamp(1.7rem,2.5vw,2.75rem)] leading-[1.1] font-medium tracking-[-0.04em]">
                      {experience.company}
                    </h3>
                    <p className="mt-6 max-w-[36ch] text-[0.95rem] leading-[1.6] text-[#dddeda]">
                      {experience.summary}
                    </p>
                  </article>
                )
              })}
            </div>
          </div>
          <p className="mt-4 max-w-[90ch] text-[0.8rem] leading-[1.6] text-muted [&_a]:underline">
            App icons use{" "}
            <a href="https://www.atlassian.com/favicon.ico">
              Atlassian’s official favicon
            </a>
            , Cycle’s production app icon, and the Kiosk and Smovin files you
            supplied. The original LinkedIn logos remain available for
            comparison. Both sets are shown at 28px without added grain.
          </p>
        </Experiment>
        <aside className="border border-ink/12 p-8">
          <h2 className="mb-2 text-[1.7rem] font-medium tracking-[-0.03em]">
            Your combination
          </h2>
          <p className="my-4 leading-[1.6] text-muted">{summary}</p>
          <button
            className="inline-flex min-h-[46px] cursor-pointer items-center justify-center rounded-full border border-[#181818] bg-linear-to-b from-[#353535] to-[#141414] px-[1.4rem] py-[0.7rem] text-[0.9rem] font-medium text-white shadow-[inset_0_1px_1px_#ffffff4d,inset_0_-1px_1px_#000,0_2px_3px_#00000024] transition-[transform,box-shadow,filter] duration-150 hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_3px_#0006,0_1px_1px_#0002]"
            type="button"
            onClick={copySelection}
          >
            Copy choices
          </button>
          <output className="mt-4 block text-[0.8rem] text-muted">
            {copyFailed
              ? "Could not copy. Select and copy the combination text above."
              : copiedSummary === summary
                ? "Choices copied"
                : "Selections stay here until you reload. Nothing is applied to the main pages."}
          </output>
        </aside>
      </main>
    </SiteShell>
  )
}
