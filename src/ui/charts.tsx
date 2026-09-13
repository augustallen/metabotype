/** SVG notebook charts with calendar spacing; ports the terminal's chart semantics. */
import { useRef } from 'preact/hooks'
import { chartGeometry, compactSeries, wpmRange } from '../core/charts.ts'
import { axisLabel } from '../core/time.ts'
import { useWidth } from './hooks.ts'

const PAD = { left: 34, right: 10, top: 8, bottom: 22 }

function axisPositions(count: number): [number, number][] {
  if (count <= 0) return []
  if (count === 1) return [[0, 1]]
  if (count === 2) return [[0, 0], [1, 2]]
  return [[0, 0], [Math.floor((count - 1) / 2), 1], [count - 1, 2]]
}

function DateAxis(props: { dates: string[]; x0: number; width: number; y: number }) {
  const includeYear = props.dates.length > 0 && props.dates[0].slice(0, 4) !== props.dates[props.dates.length - 1].slice(0, 4)
  return (
    <g class="axis-dates">
      {axisPositions(props.dates.length).map(([index, n]) => {
        const anchor = n === 0 ? 'start' : n === 2 ? 'end' : 'middle'
        const x = props.x0 + (n * props.width) / 2
        return <text key={index} x={x} y={props.y} text-anchor={anchor}>{axisLabel(props.dates[index], includeYear)}</text>
      })}
    </g>
  )
}

export interface SeriesChartProps {
  title: string
  values: (number | null)[]
  dates: string[]
  summary: string
  detail: string
  empty: string
  height?: number
}

export function LineChart(props: SeriesChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const height = props.height ?? 170
  const plotW = Math.max(40, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom
  const columns = Math.max(1, Math.floor(plotW / 3))
  const grouped = props.values.length > columns
  const series = compactSeries(props.values, columns)
  const [minimum, maximum] = wpmRange(series)
  const points = chartGeometry(series, plotW, plotH, maximum, minimum)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(PAD.left + p.x).toFixed(1)},${(PAD.top + p.y).toFixed(1)}`).join(' ')
  const markers = points.length <= columns / 3 ? points : points.slice(-1)
  const ticks = [0, 1, 2].map((i) => minimum + (i * (maximum - minimum)) / 2)
  const hasData = points.length > 0
  return (
    <figure class="chart chart-line" ref={ref}>
      <figcaption class="chart-caption">
        <span class="chart-title">{props.title}{grouped ? ' / interval medians' : ' / daily medians'}</span>
        <span class="chart-summary">{props.summary}</span>
        <span class="chart-detail">{props.detail}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={`${props.title}: ${props.summary}${props.detail ? ', ' + props.detail : ''}`}>
        {ticks.map((v) => {
          const y = PAD.top + plotH - ((v - minimum) / (maximum - minimum || 1)) * plotH
          return (
            <g key={v}>
              <line class="grid" x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} />
              <text class="axis" x={PAD.left - 6} y={y + 4} text-anchor="end">{Math.round(v)}</text>
            </g>
          )
        })}
        {hasData ? <path class="series-line" d={path} /> : null}
        {markers.map((p) => <circle key={p.index} class="marker" cx={PAD.left + p.x} cy={PAD.top + p.y} r={3.5} />)}
        {!hasData ? <text class="empty" x={PAD.left + plotW / 2} y={PAD.top + plotH / 2} text-anchor="middle">{props.empty}</text> : null}
        <DateAxis dates={props.dates} x0={PAD.left} width={plotW} y={height - 6} />
      </svg>
      {grouped ? <p class="chart-note">Lines connect played days; points summarize intervals.</p> : null}
      <DataTable dates={props.dates} values={props.values} unit="WPM" />
    </figure>
  )
}

export function StepChart(props: SeriesChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const height = props.height ?? 130
  const plotW = Math.max(40, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom
  const points = chartGeometry(props.values, plotW, plotH, 4, 1)
  let path = ''
  points.forEach((p, i) => {
    const x = (PAD.left + p.x).toFixed(1)
    const y = (PAD.top + p.y).toFixed(1)
    path += i === 0 ? `M${x},${y}` : ` H${x} V${y}`
  })
  const hasData = points.length > 0
  const last = points[points.length - 1]
  return (
    <figure class="chart chart-step" ref={ref}>
      <figcaption class="chart-caption">
        <span class="chart-title">{props.title}</span>
        <span class="chart-summary">{props.summary}</span>
        <span class="chart-detail">{props.detail}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={`${props.title}: ${props.summary}${props.detail ? ', ' + props.detail : ''}`}>
        {[1, 2, 3, 4].map((v) => {
          const y = PAD.top + plotH - ((v - 1) / 3) * plotH
          return (
            <g key={v}>
              <line class="grid" x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} />
              <text class="axis" x={PAD.left - 6} y={y + 4} text-anchor="end">{v}</text>
            </g>
          )
        })}
        {hasData ? <path class="series-step" d={path} /> : null}
        {last ? <circle class="marker" cx={PAD.left + last.x} cy={PAD.top + last.y} r={3.5} /> : null}
        {!hasData ? <text class="empty" x={PAD.left + plotW / 2} y={PAD.top + plotH / 2} text-anchor="middle">{props.empty}</text> : null}
        <DateAxis dates={props.dates} x0={PAD.left} width={plotW} y={height - 6} />
      </svg>
      <DataTable dates={props.dates} values={props.values} unit="level" />
    </figure>
  )
}

function DataTable(props: { dates: string[]; values: (number | null)[]; unit: string }) {
  const rows = props.dates.map((d, i) => [d, props.values[i]] as const).filter((r) => r[1] !== null)
  if (!rows.length) return null
  return (
    <table class="visually-hidden">
      <thead><tr><th>Date</th><th>{props.unit}</th></tr></thead>
      <tbody>{rows.map(([d, v]) => <tr key={d}><td>{d}</td><td>{props.unit === 'WPM' ? (v as number).toFixed(1) : v}</td></tr>)}</tbody>
    </table>
  )
}
