import { createFileRoute } from "@tanstack/react-router"
import { CopyEmailButton } from "../components/copy-email-button"
import { SiteShell } from "../components/site-shell"
import { experiences, professionalCopy } from "../content/professional"
import { profile } from "../content/shared"
import { ResponsiveImage } from "../features/images/responsive-image"
import metadata from "virtual:profile-images"

export const Route = createFileRoute("/")({ component: ProfessionalPage })

const companyLogos: Record<string, string> = {
  Atlassian: "atlassian.svg",
  Cycle: "cycle.png",
  Kiosk: "kiosk.png",
  Smovin: "smovin.png",
}

function ProfessionalPage() {
  return (
    <SiteShell contactTitle={professionalCopy.contact.title}>
      <main>
        <section className="border-b border-line">
          <div className="relative isolate mx-auto grid w-[calc(100%-2rem)] max-w-[1440px] overflow-hidden border-x border-line [background:radial-gradient(ellipse_at_90%_20%,#a2badc55,transparent_65%),radial-gradient(ellipse_at_30%_115%,#e7a98c66,transparent_75%),#f8f7f4] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[url('/media/brand/hero-grain.svg')] before:opacity-12 before:mix-blend-multiply sm:w-[calc(100%-4rem)] lg:w-[calc(100%-6rem)] lg:grid-cols-12">
            <div className="px-4 pt-12 pb-8 sm:px-6 lg:col-span-6 lg:px-8 lg:py-20">
              {profile.available && (
                <span className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-[#d8d7d3] bg-linear-to-b from-white to-[#eeede9] px-3.5 py-2 text-[0.8rem] text-[#625f59] shadow-[inset_0_1px_1px_#fff,inset_0_-1px_1px_#00000008,0_2px_3px_#00000006]">
                  <span
                    aria-hidden="true"
                    className="size-[7px] rounded-full bg-[radial-gradient(circle_at_35%_25%,#75b58e,#30734d_80%)] shadow-[0_0_0_2px_#39825a0a]"
                  />
                  {profile.availabilityLabel}
                </span>
              )}
              <p className="m-0 text-[0.8rem] leading-6 font-medium text-muted">
                {professionalCopy.hero.eyebrow}
              </p>
              <h1 className="mt-4 text-[clamp(3.5rem,9vw,9rem)] leading-none font-medium tracking-[-0.055em]">
                {profile.firstName}
                <span className="text-accent">.</span>
              </h1>
              <p className="mt-7 max-w-[48ch] text-[clamp(1rem,1.35vw,1.2rem)] leading-[1.65] text-pretty text-muted">
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
          <div className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] border-x border-white/10 pb-12 sm:w-[calc(100%-4rem)] lg:w-[calc(100%-6rem)] lg:pb-16">
            <div className="grid items-center gap-6 px-4 pt-12 pb-8 sm:px-6 lg:grid-cols-12 lg:gap-0 lg:px-0 lg:pt-16 lg:pb-12">
              <div className="lg:col-span-6">
                <h2 className="mt-4 max-w-[17ch] text-[clamp(2.25rem,4.3vw,4rem)] leading-[1.05] font-medium tracking-[-0.04em] text-balance lg:mx-8">
                  {professionalCopy.experience.title}
                </h2>
              </div>
              <p className="max-w-[48ch] border-l border-white/20 pl-6 text-[clamp(1.1rem,1.8vw,1.5rem)] leading-[1.65] text-pretty text-[#b9bcc2] lg:mx-8 lg:col-span-6">
                {professionalCopy.experience.introduction}
              </p>
            </div>
            <div className="-mx-px grid pr-px pb-px sm:grid-cols-2 xl:grid-cols-4">
              {experiences.map((experience) => (
                <article
                  className="relative isolate -mr-px -mb-px bg-[linear-gradient(to_bottom_left,#34373b_0%,#25282c_42%,#17191d_90%)] px-4 pt-7 pb-8 before:pointer-events-none before:absolute before:inset-0 before:border before:border-white/12 after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[url('/media/brand/grain.svg')] after:opacity-12 after:mix-blend-soft-light sm:px-6 xl:px-8"
                  key={experience.company}
                >
                  <div className="flex min-h-9 items-center justify-between gap-4">
                    <p className="text-[0.8rem] text-[#b9bcc2]">
                      {experience.period}
                    </p>
                    {companyLogos[experience.company] && (
                      <img
                        className="size-7 shrink-0 object-contain"
                        src={`/media/companies/icons/${companyLogos[experience.company]}`}
                        alt=""
                        width="28"
                        height="28"
                      />
                    )}
                  </div>
                  <h3 className="mt-6 text-[clamp(1.75rem,2.5vw,2.75rem)] leading-[1.1] font-medium tracking-[-0.04em] text-balance">
                    {experience.company}
                  </h3>
                  <p className="mt-6 max-w-[36ch] text-[0.95rem] leading-[1.6] text-[#dddeda]">
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
