// The radar's map, drawn on the surface's own frame clock: glows fade between the pane's redraws,
// and nothing ticks once every glow has died down.
import type { ClientModule } from 'claude-code'

import { DECAY_MS, fromData, layout, paint, tileColor, tileFor } from './layout'
import type { Hit, Kind, Tile, TreeData } from './layout'

export type MapProps = {
  tree: TreeData
  treeVersion: number
  // Each hit's age when the pane drew, so the two clocks never need to agree.
  hits: [path: string, kind: Kind, agent: number, ageMs: number][]
  tints: [path: string, kind: Kind][]
  columns: number
  rows: number
  stamp: number
}

type Ref = { ticks: number; stamp: number; isActive: boolean; layoutKey: string; tiles: Tile[] }
type State = { ref: Ref }

const FRAME_MS = 160

const RadarMap: ClientModule<MapProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { ticks: 0, stamp: -1, isActive: false, layoutKey: '', tiles: [] }
  if (props.stamp !== ref.stamp) {
    ref.stamp = props.stamp
    ref.ticks = 0
  }
  const elapsed = ref.ticks * FRAME_MS
  ref.isActive = props.hits.some(([, kind, , age]) => age + elapsed < DECAY_MS[kind] * 4)
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(FRAME_MS, () => {
      if (!ref.isActive) return
      ref.ticks += 1
      surface.setState({ ref })
    })
  }

  const columns = Math.max(10, surface.columns || props.columns)
  const layoutKey = `${columns}x${props.rows}:${props.treeVersion}`
  if (ref.layoutKey !== layoutKey) {
    ref.layoutKey = layoutKey
    ref.tiles = layout(fromData(props.tree), columns, props.rows)
  }
  const tiles = ref.tiles

  // Now is 0; a hit happened (age + elapsed) ago.
  const hitByTile = new Map<string, Hit>()
  for (const [path, kind, agent, age] of props.hits) {
    const key = tileFor(tiles, path)?.key
    const at = -(age + elapsed)
    if (key && (hitByTile.get(key)?.at ?? -Infinity) < at) hitByTile.set(key, { kind, agent, at })
  }
  const tintByTile = new Map<string, Kind>()
  for (const [path, kind] of props.tints) {
    const key = tileFor(tiles, path)?.key
    if (key && tintByTile.get(key) !== 'edit') tintByTile.set(key, kind)
  }

  const rows = paint(tiles, columns, props.rows, (tile, i) => tileColor(tile, i, hitByTile.get(tile.key), tintByTile.get(tile.key), 0))
  return (
    <Box flexDirection="column">
      {rows.map(runs => (
        <Text wrap="truncate">
          {runs.map(run => (run.bg ? <Text backgroundColor={run.bg} color={run.fg} bold={run.bold}>{run.text}</Text> : <Text>{run.text}</Text>))}
        </Text>
      ))}
    </Box>
  )
}

export default RadarMap
