import { useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/features/ui/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/features/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/features/ui/toggle-group"
import { formatNumber, type ChartPeriod } from "./data"

const chartConfig = {
  flights: { label: "Flights", color: "var(--chart-1)" },
  hours: { label: "Hours", color: "var(--chart-1)" },
} satisfies ChartConfig

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: readonly (readonly [T, string])[]
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="outline"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        const [picked] = next
        if (picked) onChange(picked as T)
      }}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function ActivityChart({
  monthly,
  yearly,
}: {
  readonly monthly: ChartPeriod[]
  readonly yearly: ChartPeriod[]
}) {
  const [period, setPeriod] = useState<"month" | "year">("month")
  const [metric, setMetric] = useState<"flights" | "hours">("flights")
  const rows = period === "month" ? monthly : yearly
  const label = chartConfig[metric].label
  return (
    <section aria-labelledby="activity-heading">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="activity-heading" className="text-lg font-semibold">
              Flying activity
            </h2>
          </CardTitle>
          <CardDescription>
            {period === "month" ? "Last 12 months" : "All years"} · UTC calendar
          </CardDescription>
          <CardAction className="col-start-1 row-start-3 mt-2 flex flex-wrap gap-3 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0">
            <Choice
              label="Activity metric"
              value={metric}
              onChange={setMetric}
              options={[
                ["flights", "Flights"],
                ["hours", "Hours"],
              ]}
            />
            <Choice
              label="Activity period"
              value={period}
              onChange={setPeriod}
              options={[
                ["month", "Monthly"],
                ["year", "Yearly"],
              ]}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-64 w-full justify-start tabular-nums"
            aria-label={`${label} per ${period}. Exact values are available in the activity data table below.`}
          >
            <BarChart
              accessibilityLayer
              data={rows}
              margin={{ left: -20, right: 8, top: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={20}
              />
              <YAxis
                allowDecimals={metric === "hours"}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatNumber}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)" }}
                content={
                  <ChartTooltipContent
                    hideIndicator
                    labelFormatter={(_, payload) => payload[0]?.payload.label}
                    formatter={(value) =>
                      `${formatNumber(Number(value))} ${label.toLowerCase()}`
                    }
                  />
                }
              />
              <Bar
                dataKey={metric}
                name={label}
                fill={`var(--color-${metric})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={56}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
          <details className="mt-4 text-sm">
            <summary className="w-fit cursor-pointer rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
              View activity data
            </summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <Table className="tabular-nums">
                <caption className="sr-only">
                  {period === "month" ? "Monthly" : "Yearly"} flying activity
                  (UTC)
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Flights</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.period}>
                      <TableHead scope="row" className="font-normal">
                        {row.label}
                      </TableHead>
                      <TableCell className="text-right">
                        {formatNumber(row.flights)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.hours)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </CardContent>
      </Card>
    </section>
  )
}
