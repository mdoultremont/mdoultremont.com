import { createFileRoute } from "@tanstack/react-router"
import { CopyEmailButton } from "@/features/site/copy-email-button"
import { SiteShell } from "@/features/site/site-shell"
import { experiences, professionalCopy } from "@/content/professional"
import { profile } from "@/content/shared"
import { pageHead } from "@/features/seo/page-head"
import { ResponsiveImage } from "@/features/images/responsive-image"
import metadata from "virtual:profile-images"

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      title: "Matthieu d'Oultremont · Software developer",
      description:
        "Software developer, photographer and paraglider pilot based in Brussels. Matthieu d'Oultremont is available for his next role.",
      path: "/",
      ogImage: {
        eyebrow: professionalCopy.hero.eyebrow,
        title: profile.name,
      },
    }),
  component: ProfessionalPage,
})

const companyLogos: Record<string, string> = {
  Atlassian: "atlassian.svg",
  Cycle: "cycle.png",
  Kiosk: "kiosk.png",
  Smovin: "smovin.png",
}

function ProfessionalPage() {
  return (
    <SiteShell contactTitle={professionalCopy.contact.title}>
      <main id="main-content">
        <section className="border-b border-line">
          <div className="relative isolate mx-auto grid w-[calc(100%-2rem)] max-w-[1440px] overflow-hidden border-x border-line [background:radial-gradient(ellipse_at_90%_20%,#a2badc55,transparent_65%),radial-gradient(ellipse_at_30%_115%,#e7a98c66,transparent_75%),#f8f7f4] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[url('/media/brand/hero-grain.svg')] before:opacity-[0.035] before:mix-blend-multiply sm:w-[calc(100%-4rem)] lg:w-[calc(100%-6rem)] lg:grid-cols-12">
            <div className="px-4 pt-12 pb-8 sm:px-6 lg:col-span-6 lg:px-8 lg:py-16">
              {profile.available && (
                <span className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-[#d8d7d3] bg-linear-to-b from-white to-[#eeede9] px-3.5 py-2 text-[0.8rem] text-[#625f59] shadow-[inset_0_1px_1px_#fff,inset_0_-1px_1px_#00000008,0_2px_3px_#00000006]">
                  <span
                    aria-hidden="true"
                    className="size-[7px] rounded-full bg-[radial-gradient(circle_at_35%_25%,#75b58e,#30734d_80%)] shadow-[0_0_0_2px_#39825a0a]"
                  />
                  {profile.availabilityLabel}
                </span>
              )}
              <p className="m-0 text-[0.8rem] leading-6 font-medium text-muted-foreground">
                {professionalCopy.hero.eyebrow}
              </p>
              <h1 className="mt-4 text-[clamp(3.5rem,9vw,9rem)] leading-none font-medium tracking-[-0.04em]">
                {profile.firstName}
                <span className="text-brand">.</span>
              </h1>
              <p className="mt-7 max-w-[48ch] text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.65] text-pretty text-muted-foreground">
                {professionalCopy.hero.introduction}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <CopyEmailButton className="inline-flex min-h-[46px] cursor-pointer items-center justify-center rounded-full border border-[#181818] bg-linear-to-b from-[#353535] to-[#141414] px-[1.4rem] py-[0.7rem] text-[0.9rem] font-medium text-white shadow-[inset_0_1px_1px_#ffffff4d,inset_0_-1px_1px_#000,0_2px_3px_#00000024] transition-[transform,box-shadow,filter] duration-150 hover:brightness-110 active:translate-y-px active:shadow-[inset_0_2px_3px_#0006,0_1px_1px_#0002]">
                  Get in touch
                </CopyEmailButton>
                <a
                  className="relative inline-flex min-h-11 items-center text-sm font-medium after:pointer-events-none after:absolute after:-right-1 after:bottom-2 after:-left-1 after:h-px after:bg-[linear-gradient(90deg,transparent,#666_12%,#666_88%,transparent)] hover:after:bg-[linear-gradient(90deg,transparent,#121212_12%,#121212_88%,transparent)]"
                  href="#experience"
                >
                  See my experience
                </a>
              </div>
            </div>
            <div className="grid min-w-0 justify-items-center overflow-hidden items-end lg:col-span-6">
              <ResponsiveImage
                className="block h-auto max-h-[360px] max-w-full object-contain object-bottom lg:h-[90%] lg:max-h-[600px]"
                sizes="(min-width: 1024px) 46vw, 90vw"
                fetchPriority="high"
                src={profile.professionalPortrait}
                image={metadata[profile.professionalPortrait]}
                alt="Matthieu d'Oultremont"
              />
            </div>
          </div>
        </section>
        <section
          className="border-b border-line"
          aria-label="Short introduction"
        >
          <div className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] border-x border-line px-4 py-12 sm:w-[calc(100%-4rem)] sm:px-6 lg:w-[calc(100%-6rem)] lg:px-8 lg:py-16">
            <p className="mx-auto max-w-[36ch] text-center text-[clamp(1.8rem,3.4vw,3.25rem)] leading-[1.18] font-medium tracking-[-0.035em] text-balance">
              {professionalCopy.statement}
            </p>
          </div>
        </section>
        <section
          className="relative isolate scroll-mt-20 [background:radial-gradient(ellipse_at_10%_0%,rgb(142_172_203_/_13%),transparent_60%),#171717] text-paper after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[url('/media/brand/grain.svg')] after:opacity-[0.045]"
          id="experience"
        >
          <div className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] border-x border-white/10 px-4 pt-12 pb-8 sm:w-[calc(100%-4rem)] sm:px-6 lg:grid lg:w-[calc(100%-6rem)] lg:grid-cols-[0.8fr_1.5fr] lg:gap-20 lg:px-8 lg:py-16">
            <header className="pb-10 lg:pb-0">
              <h2 className="max-w-[17ch] text-[2.25rem] leading-[1.05] font-medium tracking-[-0.04em] text-balance lg:text-5xl">
                {professionalCopy.experience.title}
              </h2>
              <p className="mt-6 max-w-[48ch] text-lg leading-[1.65] text-pretty text-[#b9bcc2] lg:mt-7 lg:text-[1.1875rem]">
                {professionalCopy.experience.introduction}
              </p>
            </header>
            <div>
              {experiences.map((experience) => (
                <article
                  className="grid gap-3 border-t border-white/20 py-7 -mx-4 px-4 sm:-mx-6 sm:grid-cols-[1fr_auto] sm:gap-x-6 sm:gap-y-4 sm:px-6 lg:-mr-8 lg:-ml-10 lg:py-8 lg:pr-8 lg:pl-10"
                  key={experience.company}
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    {companyLogos[experience.company] && (
                      <img
                        className="size-7 shrink-0 object-contain sm:size-8"
                        src={`/media/companies/icons/${companyLogos[experience.company]}`}
                        alt=""
                        width="32"
                        height="32"
                      />
                    )}
                    <h3 className="text-[1.75rem] leading-[1.15] font-medium tracking-[-0.04em] sm:text-[2rem]">
                      {experience.company}
                    </h3>
                  </div>
                  <p className="ml-10 text-[0.8125rem] leading-[1.6] text-[#b9bcc2] tabular-nums whitespace-nowrap sm:ml-0 sm:pt-2">
                    {experience.period}
                  </p>
                  <p className="mt-1 ml-10 max-w-[48ch] text-base leading-[1.65] text-[#dddeda] sm:col-span-2 sm:mt-0 sm:ml-12 sm:text-[1.0625rem]">
                    {experience.summary}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  )
}
