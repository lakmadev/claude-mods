import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { AGENT_COLORS, COLORS, DECAY_MS, addPath, buildTree, glowColor, hex, intensity, layout, tileColor, tileFor, toCells, toSvg } from './layout'
import type { Hit, Kind, Tile, Tree } from './layout'

const PANE = 'radar'
const TITLE = 'Repo Radar'
const FRAME_MS = 150
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const version = atom({ plugin: 'repo-radar', key: 'version' } as const, 0)

// ponytail: session picture lives in module state; a hot reload starts the map fresh.
let root = ''
let isGit = false
let tree: Tree = new Map()
let fileCount = 0
let treeVersion = 0
let cached = { key: '', tiles: [] as Tile[] }
let mounted: { columns: number; rows: number } | undefined
let lastBump = 0
const hits = new Map<string, Hit>()
const touched = new Map<string, Kind>()
const agents = new Map<string, number>()
const feed: { kind: Kind; path: string; agent: string | undefined; at: number }[] = []

const agentIndex = (id: string) => agents.get(id) ?? 0

function tilesFor(columns: number, rows: number): Tile[] {
  const key = `${columns}x${rows}:${treeVersion}`
  if (cached.key !== key) cached = { key, tiles: layout(tree, columns, rows) }
  return cached.tiles
}

// The latest hit and the strongest lasting tint of every tile, from the paths that map to it.
function heatByTile(tiles: readonly Tile[]) {
  const hit = new Map<string, Hit>()
  const tint = new Map<string, Kind>()
  for (const [path, h] of hits) {
    const key = tileFor(tiles, path)?.key
    if (key && (hit.get(key)?.at ?? -1) < h.at) hit.set(key, h)
  }
  for (const [path, kind] of touched) {
    const key = tileFor(tiles, path)?.key
    if (key && tint.get(key) !== 'edit') tint.set(key, kind)
  }
  return { hit, tint }
}

export function relative(path: string, base: string): string | undefined {
  if (!path.startsWith('/')) return path.replace(/^\.\//, '').replace(/\/$/, '') || undefined
  if (path === base) return undefined
  return path.startsWith(base + '/') ? path.slice(base.length + 1).replace(/\/$/, '') : undefined
}

async function loadRepo($: EngineInterface) {
  const cwd = await $.session.cwd()
  const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 3000 }).catch(() => undefined)
  isGit = top?.exitCode === 0
  root = isGit ? top!.stdout.trim() : cwd
  const files = isGit ? await $.process.run(['git', '-C', root, 'ls-files'], { timeoutMs: 10_000 }).catch(() => undefined) : undefined
  const paths = files?.exitCode === 0 ? files.stdout.split('\n').filter(Boolean) : []
  tree = buildTree(paths)
  fileCount = paths.length
  treeVersion += 1
}

async function record($: EngineInterface, rawPath: string, kind: Kind, agent: string | undefined) {
  const path = relative(rawPath, root)
  if (!path) return
  const now = await $.clock.now()
  // A folder the index doesn't know yet (a new file, or no git): give it a tile.
  const [top, second] = path.split('/')
  const known = tree.get(top!)
  if (!known || (path.includes('/') && !known.children.has(second!))) {
    addPath(tree, path)
    fileCount += 1
    treeVersion += 1
  }
  if (agent !== undefined && !agents.has(agent)) agents.set(agent, agents.size)
  hits.set(path, { kind, agent, at: now })
  if (kind !== 'error' && touched.get(path) !== 'edit') touched.set(path, kind)
  if (hits.size > 600) hits.delete(hits.keys().next().value!)
  feed.unshift({ kind, path, agent, at: now })
  feed.length = Math.min(feed.length, 5)
  if (now - lastBump > 200) {
    lastBump = now
    await update($, version, v => v + 1)
  }
}

async function frame($: EngineInterface) {
  if (!mounted) return
  const now = await $.clock.now()
  const isHot = [...hits.values()].some(h => now - h.at < DECAY_MS[h.kind] * 4)
  if (!isHot) return
  const { columns, rows } = mounted
  const tiles = tilesFor(columns, rows)
  const { hit, tint } = heatByTile(tiles)
  const cells = toCells(tiles, columns, rows, (tile, i) => tileColor(tile, i, hit.get(tile.key), tint.get(tile.key), now, agentIndex))
  await $.ui.blit({ requestId: PANE, key: 'map', cells }).catch(() => {
    mounted = undefined
  })
}

function clear() {
  hits.clear()
  touched.clear()
  agents.clear()
  feed.length = 0
}

const VERB: Record<Kind, string> = { read: 'read', edit: 'edit', error: 'fail' }

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'radar', description: 'Live map of where Claude is working in your repo', argumentHint: '[reset]' })
    await loadRepo($).catch(() => undefined)
    $.clock.every(FRAME_MS, () => void frame($).catch(() => undefined))
    if (options.openOnStart !== false) $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'radar' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      clear()
      await loadRepo($).catch(() => undefined)
      await update($, version, v => v + 1)
      return { text: 'Radar cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return {}
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const path = args.file_path ?? args.notebook_path ?? args.path
    const kind: Kind | undefined = ran.isError ? 'error' : EDIT_TOOLS.includes(tool) ? 'edit' : READ_TOOLS.includes(tool) ? 'read' : undefined
    if (kind && typeof path === 'string') await record($, path, kind, e.agentId).catch(() => undefined)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, version)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    // Choose by surface: every table lists Raster, but only the terminal draws it.
    const isTerminal = e.surface === 'terminal'
    const columns = isTerminal ? Math.max(20, e.props.bodyColumns ?? 60) : 80
    const rows = isTerminal ? Math.max(8, Math.min(40, (e.viewport?.rows ?? 32) - 12)) : 26
    const tiles = tilesFor(columns, rows)
    const { hit, tint } = heatByTile(tiles)
    const look = (tile: Tile, i: number) => tileColor(tile, i, hit.get(tile.key), tint.get(tile.key), now, agentIndex)

    let map
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      mounted = { columns, rows }
      map = <Raster key="map" columns={columns} rows={rows} cells={toCells(tiles, columns, rows, look)} />
    } else {
      const { Svg } = $.ui.resolve(e)
      mounted = undefined
      const svg = toSvg(tiles, columns, rows, (tile, i) => {
        const h = hit.get(tile.key)
        const rest = tileColor(tile, i, undefined, tint.get(tile.key), now, agentIndex).bg
        return { ...look(tile, i), rest, remainingMs: h ? DECAY_MS[h.kind] * 3 - (now - h.at) : 0 }
      })
      map = <Svg source={svg} alt={`Repo map: ${touched.size} files touched this session`} isInteractive />
    }

    const edits = [...touched.values()].filter(k => k === 'edit').length
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={2} flexWrap="wrap">
          <Text bold color={hex(COLORS.read)}>◉ REPO RADAR</Text>
          <Text dimColor>
            {fileCount.toLocaleString('en-US')} files · {touched.size} touched · {edits} edited{agents.size ? ` · ${agents.size} agents` : ''}{isGit ? '' : ' · not a git repo, tiles appear as files are touched'}
          </Text>
        </Box>
        <Box gap={2} flexWrap="wrap">
          <Text color={hex(COLORS.read)}>■ read</Text>
          <Text color={hex(COLORS.edit)}>■ edit</Text>
          <Text color={hex(COLORS.error)}>■ error</Text>
          {[...agents].map(([id, i]) => (
            <Text color={hex(AGENT_COLORS[i % AGENT_COLORS.length]!)}>■ agent {i + 1}</Text>
          ))}
          <Text dimColor>faint tint = touched this session</Text>
        </Box>
        {map}
        <Box flexDirection="column">
          {feed.length === 0 && <Text dimColor>Waiting for Claude to touch a file…</Text>}
          {feed.map(event => (
            <Text>
              <Text color={hex(glowColor({ kind: event.kind, agent: event.agent, at: 0 }, agentIndex))}>● {VERB[event.kind]}</Text>
              <Text dimColor={now - event.at > 15_000}> {event.path}</Text>
              {event.agent !== undefined && <Text dimColor> · agent {agentIndex(event.agent) + 1}</Text>}
            </Text>
          ))}
        </Box>
        <Button key="reset" label="Reset" plain dimColor onPress={() => (clear(), update($, version, v => v + 1))} />
      </Box>
    )
  })
}
