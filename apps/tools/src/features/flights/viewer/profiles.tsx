import { useId } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/features/ui/chart"
import type { ProfilePoint } from "@mdoultremont/tools-contracts/flights"
import { formatProfileTime } from "./logic"

const chartConfig = {
  altM: { label: "Altitude", color: "var(--flight-altitude)" },
  speedKmh: { label: "Ground speed", color: "var(--flight-speed)" },
  varioMps: { label: "Vertical speed", color: "var(--flight-vario)" },
} satisfies ChartConfig

interface Props {
  altitude: readonly ProfilePoint[]
  speed: readonly ProfilePoint[]
  vario: readonly ProfilePoint[]
  activeSeconds: number | null
  onTime: (seconds: number) => void
}
export function FlightProfiles({
  altitude,
  speed,
  vario,
  activeSeconds,
  onTime,
}: Props) {
  const gradient = useId().replace(/:/g, "")
  return (
    <div className="space-y-6">
      {(
        [
          {
            key: "altM",
            label: "Altitude",
            unit: "m",
            data: altitude,
            color: "var(--color-altM)",
          },
          {
            key: "speedKmh",
            label: "Ground speed",
            unit: "km/h",
            data: speed,
            color: "var(--color-speedKmh)",
          },
          {
            key: "varioMps",
            label: "Vertical speed",
            unit: "m/s",
            data: vario,
            color: "var(--color-varioMps)",
          },
        ] as const
      ).map((series) => (
        <section key={series.key} aria-label={`${series.label} profile`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              {series.label}{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                {series.unit}
              </span>
            </h2>
            <span className="text-xs text-muted-foreground">
              Time since takeoff
            </span>
          </div>
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[180px] min-w-0 w-full justify-start"
          >
            <ComposedChart
              data={series.data}
              margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
              accessibilityLayer
              onMouseMove={(state) => {
                const seconds = Number(state.activeLabel)
                if (state.activeLabel !== undefined && Number.isFinite(seconds))
                  onTime(seconds)
              }}
            >
              <defs>
                <linearGradient
                  id={`${gradient}-${series.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={series.color}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={series.color}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--flight-grid)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="tS"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatProfileTime}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                width={48}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  Math.round(Number(value)).toLocaleString()
                }
              />
              <ChartTooltip content={() => null} cursor={false} />
              {series.key === "altM" ? (
                <Area
                  type="linear"
                  dataKey={series.key}
                  stroke={series.color}
                  fill={`url(#${gradient}-${series.key})`}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  type="linear"
                  dataKey={series.key}
                  stroke={series.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {activeSeconds !== null && (
                <ReferenceLine
                  x={activeSeconds}
                  stroke="var(--foreground)"
                  strokeDasharray="4 3"
                />
              )}
            </ComposedChart>
          </ChartContainer>
        </section>
      ))}
    </div>
  )
}
