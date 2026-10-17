import { createLucideIcon } from "lucide-react"

/** A paraglider wing over its pilot, drawn on Lucide's grid since Lucide has no parachute. */
export const ParagliderIcon = createLucideIcon("paraglider", [
  ["path", { d: "M2 10C3.5 5.5 7.5 3 12 3s8.5 2.5 10 7", key: "canopy-top" }],
  [
    "path",
    { d: "M2 10c3-1.5 6.5-2.2 10-2.2s7 .7 10 2.2", key: "canopy-bottom" },
  ],
  ["path", { d: "m2 10 9 8.5", key: "line-left" }],
  ["path", { d: "m22 10-9 8.5", key: "line-right" }],
  ["circle", { cx: "12", cy: "20.5", r: "1.5", key: "pilot" }],
])
