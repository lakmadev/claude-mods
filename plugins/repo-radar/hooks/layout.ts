// Pure parts of the radar, shared by the hooks module and the map's surface module:
// the repo tree, a squarified treemap in terminal cells, heat colors, and rows of colored runs.

export type Tree = Map<string, { files: number; children: Map<string, number> }>
export type TreeData = [name: string, files: number, children: [name: string, files: number][]][]
export type Tile = { key: string; label: string; x0: number; y0: number; x1: number; y1: number; isHeader: boolean }
export type Kind = 'read' | 'edit' | 'error'
export type Hit = { kind: Kind; agent: number; at: number } // agent -1 is the main loop
export type Run = { text: string; bg?: string; fg?: string; bold?: boolean }

const MAX_PER_LEVEL = 12
const MAX_SENT_CHILDREN = 30
export const MORE = '…'

export function addPath(tree: Tree, path: string): void {
  const [top, second] = path.split('/')
  if (!top) return
  const group = tree.get(top) ?? { files: 0, children: new Map<string, number>() }
  group.files += 1
  if (second !== undefined && path.includes('/')) group.children.set(second, (group.children.get(second) ?? 0) + 1)
  tree.set(top, group)
}

export function buildTree(paths: readonly string[]): Tree {
  const tree: Tree = new Map()
  for (const path of paths) if (path) addPath(tree, path)
  return tree
}

// What crosses to the surface module: small folders folded into one `…` child, so props stay small.
export function treeData(tree: Tree): TreeData {
  return [...tree].map(([name, g]) => {
    const kids = [...g.children].sort((a, b) => b[1] - a[1])
    const rest = kids.slice(MAX_SENT_CHILDREN).reduce((sum, [, n]) => sum + n, 0)
    return [name, g.files, rest ? [...kids.slice(0, MAX_SENT_CHILDREN), [MORE, rest]] : kids]
  })
}

export const fromData = (data: TreeData): Tree => new Map(data.map(([name, files, kids]) => [name, { files, children: new Map(kids) }]))

type Item = { key: string; label: string; weight: number }
type Rect = { x: number; y: number; w: number; h: number }

// Big counts would drown small folders; a softened weight keeps them visible.
const weigh = (files: number) => Math.pow(files, 0.7)

function topN(items: Item[]): Item[] {
  const sorted = [...items].sort((a, b) => b.weight - a.weight)
  if (sorted.length <= MAX_PER_LEVEL) return sorted
  const rest = sorted.slice(MAX_PER_LEVEL - 1)
  return [...sorted.slice(0, MAX_PER_LEVEL - 1), { key: rest[0]!.key.replace(/[^/]*$/, MORE), label: `+${rest.length} more`, weight: rest.reduce((s, i) => s + i.weight, 0) }]
}

// Bruls, Huizing & van Wijk's squarified treemap.
export function squarify(items: readonly Item[], rect: Rect): (Item & Rect)[] {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return []
  const scale = (rect.w * rect.h) / total
  const nodes = items.filter(i => i.weight > 0).map(i => ({ ...i, area: i.weight * scale }))
  const out: (Item & Rect)[] = []
  const worst = (row: typeof nodes, side: number) => {
    const sum = row.reduce((s, n) => s + n.area, 0)
    const areas = row.map(n => n.area)
    return Math.max((side * side * Math.max(...areas)) / (sum * sum), (sum * sum) / (side * side * Math.min(...areas)))
  }
  const place = (row: typeof nodes, r: Rect): Rect => {
    const sum = row.reduce((s, n) => s + n.area, 0)
    if (r.w >= r.h) {
      const w = sum / r.h
      let y = r.y
      for (const n of row) out.push({ key: n.key, label: n.label, weight: n.weight, x: r.x, y, w, h: n.area / w }), (y += n.area / w)
      return { x: r.x + w, y: r.y, w: r.w - w, h: r.h }
    }
    const h = sum / r.w
    let x = r.x
    for (const n of row) out.push({ key: n.key, label: n.label, weight: n.weight, x, y: r.y, w: n.area / h, h }), (x += n.area / h)
    return { x: r.x, y: r.y + h, w: r.w, h: r.h - h }
  }
  let r = rect
  let row: typeof nodes = []
  for (const node of nodes) {
    const side = Math.min(r.w, r.h)
    if (row.length === 0 || worst([...row, node], side) <= worst(row, side)) row.push(node)
    else {
      r = place(row, r)
      row = [node]
    }
  }
  if (row.length) place(row, r)
  return out
}

// Layout in cells. Squarify runs in square units (a cell is about twice as tall as wide), then snaps to the grid.
export function layout(tree: Tree, columns: number, rows: number): Tile[] {
  const snap = (item: Item & Rect, rowOffset = 0) => ({
    x0: Math.round(item.x), x1: Math.round(item.x + item.w),
    y0: rowOffset + Math.round(item.y / 2), y1: rowOffset + Math.round((item.y + item.h) / 2),
  })
  const groups = topN([...tree].map(([key, g]) => ({ key, label: key, weight: weigh(g.files) })))
  const tiles: Tile[] = []
  for (const group of squarify(groups, { x: 0, y: 0, w: columns, h: rows * 2 })) {
    const cell = snap(group)
    if (cell.x1 <= cell.x0 || cell.y1 <= cell.y0) continue
    const children = tree.get(group.key)?.children
    const canSplit = children && children.size > 0 && cell.y1 - cell.y0 >= 3 && cell.x1 - cell.x0 >= 8
    if (!canSplit) {
      tiles.push({ key: group.key, label: group.label, ...cell, isHeader: false })
      continue
    }
    tiles.push({ key: group.key, label: `${group.label}/`, ...cell, y1: cell.y0 + 1, isHeader: true })
    const items = topN([...children].map(([name, files]) => ({ key: `${group.key}/${name}`, label: name, weight: weigh(files) })))
    const area = { x: cell.x0, y: 0, w: cell.x1 - cell.x0, h: (cell.y1 - cell.y0 - 1) * 2 }
    for (const child of squarify(items, area)) {
      const c = snap(child, cell.y0 + 1)
      if (c.x1 > c.x0 && c.y1 > c.y0) tiles.push({ key: child.key, label: child.label, ...c, isHeader: false })
    }
  }
  return tiles
}

// Which tile lights up for a path: its second-level folder, else its top folder, else the overflow tile.
export function tileFor(tiles: readonly Tile[], path: string): Tile | undefined {
  const [top, second] = path.split('/')
  const byKey = (key: string) => tiles.find(t => t.key === key && !t.isHeader) ?? tiles.find(t => t.key === key)
  return (second !== undefined && path.includes('/') ? byKey(`${top}/${second}`) ?? byKey(`${top}/${MORE}`) : undefined) ?? byKey(top!) ?? byKey(MORE)
}

// The zone a path counts toward in the hot-zones list: its first two segments.
export const zoneOf = (path: string) => (path.includes('/') ? path.split('/').slice(0, 2).join('/') : path)

export const COLORS = {
  header: 0x161b26,
  headerText: 0x8b93a7,
  tileA: 0x1c2533,
  tileB: 0x222d3d,
  text: 0xd1d5db,
  dark: 0x0b0f17,
  read: 0x38bdf8,
  edit: 0xf59e0b,
  error: 0xef4444,
}
export const AGENT_COLORS = [0xa78bfa, 0xf472b6, 0xa3e635, 0x2dd4bf, 0xfb923c, 0x60a5fa]
export const DECAY_MS: Record<Kind, number> = { read: 5000, edit: 10000, error: 6000 }

export const agentColor = (agent: number) => AGENT_COLORS[agent % AGENT_COLORS.length]!

export function glowColor(hit: Pick<Hit, 'kind' | 'agent'>): number {
  if (hit.kind === 'error') return COLORS.error
  if (hit.agent < 0) return COLORS[hit.kind]
  return hit.kind === 'read' ? mix(agentColor(hit.agent), COLORS.tileA, 0.35) : agentColor(hit.agent)
}

export const intensity = (hit: Hit, now: number) => Math.max(0, Math.exp(-(now - hit.at) / DECAY_MS[hit.kind]) - 0.02)

export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

// What a tile looks like now: resting shade, a faint tint once touched, the glow of its latest hit.
export function tileColor(tile: Tile, index: number, hit: Hit | undefined, touched: Kind | undefined, now: number) {
  const rest = tile.isHeader ? COLORS.header : index % 2 ? COLORS.tileA : COLORS.tileB
  const tinted = touched ? mix(rest, COLORS[touched], 0.16) : rest
  if (!hit) return { bg: tinted, glow: 0 }
  const glow = intensity(hit, now)
  return { bg: mix(tinted, glowColor(hit), Math.min(0.9, glow)), glow }
}

// The map as rows of runs: one run per tile per row, a blank gutter column between tiles,
// the label on each tile's first row. Every surface draws it with Text alone.
export function paint(tiles: readonly Tile[], columns: number, rows: number, look: (tile: Tile, index: number) => { bg: number; glow: number }): Run[][] {
  const owner = Array.from({ length: rows }, () => Array<number>(columns).fill(-1))
  tiles.forEach((t, i) => {
    const right = t.x1 - t.x0 > 2 ? t.x1 - 1 : t.x1
    for (let y = t.y0; y < Math.min(t.y1, rows); y++) for (let x = t.x0; x < Math.min(right, columns); x++) owner[y]![x] = i
  })
  const looks = tiles.map(look)
  return owner.map((row, y) => {
    const runs: Run[] = []
    for (let x = 0; x < columns; ) {
      const i = row[x]!
      let end = x
      while (end < columns && row[end] === i) end++
      const width = end - x
      const tile = tiles[i]
      if (!tile) runs.push({ text: ' '.repeat(width) })
      else {
        const { bg, glow } = looks[i]!
        const label = y === tile.y0 && width >= 4 ? ` ${tile.label}` : ''
        const text = label.length > width ? `${label.slice(0, Math.max(0, width - 1))}…`.slice(0, width) : label.padEnd(width)
        const fg = glow > 0.45 ? COLORS.dark : tile.isHeader ? COLORS.headerText : COLORS.text
        runs.push({ text, bg: hex(bg), fg: hex(fg), bold: label !== '' && glow > 0.3 })
      }
      x = end
    }
    return runs
  })
}
