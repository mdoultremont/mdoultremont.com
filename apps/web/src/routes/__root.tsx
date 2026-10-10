import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import appCss from "@/styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Matthieu d'Oultremont · Software developer",
      },
      {
        name: "description",
        content:
          "Software developer, photographer and paraglider pilot based in Brussels. Matthieu d'Oultremont is available for his next role.",
      },
      {
        property: "og:title",
        content: "Matthieu d'Oultremont · Software developer",
      },
      {
        property: "og:description",
        content: "Software, photographs, and the view from above.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "64x64",
        href: "/favicon-64.png",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="min-h-full min-w-80 scroll-smooth">
      <head>
        <HeadContent />
      </head>
      <body className="min-w-80 bg-paper font-sans text-ink antialiased [text-rendering:optimizeLegibility]">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
