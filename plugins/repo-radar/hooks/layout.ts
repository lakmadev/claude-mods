// Pure parts of the radar: the repo tree, a squarified treemap in terminal cells, and heat colors.

export type Tree = Map<string, { files: number; children: Map<string, number> }>
export type Tile = { key: string; label: string; x0: number; y0: number; x1: number; y1: number; isHeader: boolean }
export type Kind = 'read' | 'edit' | 'error'
export type Hit = { kind: Kind; agent: string | undefined; at: number }

const MAX_PER_LEVEL = 12
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

export const COLORS = {
  gap: 0x0b0f17,
  header: 0x111827,
  headerText: 0x9ca3af,
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

export function glowColor(hit: Hit, agentIndex: (id: string) => number): number {
  if (hit.kind === 'error') return COLORS.error
  if (hit.agent === undefined) return COLORS[hit.kind]
  const base = AGENT_COLORS[agentIndex(hit.agent) % AGENT_COLORS.length]!
  return hit.kind === 'read' ? mix(base, COLORS.tileA, 0.35) : base
}

export const intensity = (hit: Hit, now: number) => Math.max(0, Math.exp(-(now - hit.at) / DECAY_MS[hit.kind]) - 0.02)

export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

// What a tile looks like now: resting shade, a faint tint once touched, the glow of its latest hit.
export function tileColor(tile: Tile, index: number, hit: Hit | undefined, touched: Kind | undefined, now: number, agentIndex: (id: string) => number) {
  const rest = tile.isHeader ? COLORS.header : index % 2 ? COLORS.tileA : COLORS.tileB
  const tinted = touched ? mix(rest, COLORS[touched], 0.16) : rest
  if (!hit) return { bg: tinted, glow: 0 }
  const glow = intensity(hit, now)
  return { bg: mix(tinted, glowColor(hit, agentIndex), Math.min(0.9, glow)), glow }
}

const printable = (text: string) => text.replace(/[^\x20-\x7e]/g, '?')

// Raster cells: [codePoint, fg, bg] little-endian u32 triplets, base64.
export function toCells(
  tiles: readonly Tile[],
  columns: number,
  rows: number,
  look: (tile: Tile, index: number) => { bg: number; glow: number },
): string {
  const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => [0x20, COLORS.text, COLORS.gap]))
  tiles.forEach((tile, index) => {
    const { bg, glow } = look(tile, index)
    const fg = tile.isHeader ? (glow > 0.3 ? COLORS.dark : COLORS.headerText) : glow > 0.45 ? COLORS.dark : COLORS.text
    const right = tile.x1 - tile.x0 > 2 ? tile.x1 - 1 : tile.x1 // one-column gutter between tiles
    for (let y = tile.y0; y < Math.min(tile.y1, rows); y++) {
      for (let x = tile.x0; x < Math.min(right, columns); x++) grid[y]![x] = [0x20, fg, bg]
    }
    const label = printable(tile.label).slice(0, Math.max(0, right - tile.x0 - 1))
    ;[...label].forEach((ch, i) => {
      if (tile.y0 < rows && tile.x0 + 1 + i < columns) grid[tile.y0]![tile.x0 + 1 + i] = [ch.charCodeAt(0), fg, bg]
    })
  })
  const view = new DataView(new ArrayBuffer(columns * rows * 12))
  let at = 0
  for (const row of grid) for (const cell of row) for (const word of cell) view.setUint32(at, word, true), (at += 4)
  return toBase64(new Uint8Array(view.buffer))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

const escapeXml = (text: string) => text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

// Desktop: the same tiles in SVG; a glowing tile fades back to rest on its own via SMIL.
export function toSvg(
  tiles: readonly Tile[],
  columns: number,
  rows: number,
  look: (tile: Tile, index: number) => { bg: number; glow: number; rest: number; remainingMs: number },
): string {
  const cw = 9
  const ch = 18
  const body = tiles.map((tile, index) => {
    const { bg, glow, rest, remainingMs } = look(tile, index)
    const x = tile.x0 * cw
    const y = tile.y0 * ch
    const w = Math.max(1, (tile.x1 - tile.x0) * cw - 3)
    const h = Math.max(1, (tile.y1 - tile.y0) * ch - (tile.isHeader ? 1 : 3))
    const fade = glow > 0.02 ? `<animate attributeName="fill" from="${hex(bg)}" to="${hex(rest)}" dur="${Math.max(0.3, remainingMs / 1000).toFixed(2)}s" fill="freeze"/>` : ''
    const textFill = tile.isHeader ? hex(COLORS.headerText) : hex(COLORS.text)
    const maxChars = Math.floor(w / 7) - 1
    const label = maxChars > 1 ? `<text x="${x + 6}" y="${y + 13}" fill="${textFill}" font-size="11">${escapeXml(tile.label.slice(0, maxChars))}</text>` : ''
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${tile.isHeader ? 2 : 4}" fill="${hex(bg)}">${fade}<title>${escapeXml(tile.key)}</title></rect>${label}`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cw}" height="${rows * ch}" font-family="ui-monospace,Menlo,monospace"><rect width="100%" height="100%" rx="6" fill="${hex(COLORS.gap)}"/>${body.join('')}</svg>`
}
