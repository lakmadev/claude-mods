import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { COLORS, agentColor, addPath, buildTree, glowColor, hex, mix, treeData, zoneOf } from './layout'
import type { Kind, Tree } from './layout'
import type { MapProps } from './map'
import type { SweepProps } from './sweep'

const PANE = 'radar'
const TITLE = 'Repo Radar'
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const GLOW_WINDOW_MS = 60_000

// Chrome follows the person's Claude Code theme; the map and agent swatches need fixed colours to mix.
const C = { main: 'claude', map: 'suggestion', agents: 'merged', zones: 'warning', feed: 'subtle', dim: 'inactive', faint: 'subtle' } as const
const VERB: Record<Kind, string> = { read: 'read', edit: 'edit', error: 'fail' }
const SWEEP_TRAIL = [0xffffff, 0xd97757, 0xb8603f, 0x7a4430].map(hex)

const version = atom({ plugin: 'repo-radar', key: 'version' } as const, 0)

type Agent = { index: number; name: string; reads: number; edits: number; last: string }
type Zone = { reads: number; edits: number; fails: number; at: number }

// ponytail: the session's picture lives in module state; a hot reload starts the map fresh.
let root = ''
let repoName = ''
let branch = ''
let isGit = false
let tree: Tree = new Map()
let fileCount = 0
let treeVersion = 0
let isWorking = false
let fails = 0
let lastBump = 0
const hits = new Map<string, { kind: Kind; agent: number; at: number }>()
const touched = new Map<string, Kind>()
const agents = new Map<string, Agent>()
const zones = new Map<string, Zone>()
const feed: { kind: Kind; path: string; agent: number; at: number }[] = []

export function relative(path: string, base: string): string | undefined {
  if (!path.startsWith('/')) return path.replace(/^\.\//, '').replace(/\/$/, '') || undefined
  if (path === base) return undefined
  return path.startsWith(base + '/') ? path.slice(base.length + 1).replace(/\/$/, '') : undefined
}

export const gauge = (fraction: number, width = 10) => {
  const filled = Math.max(fraction > 0 ? 1 : 0, Math.min(width, Math.round(fraction * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

const heat = (z: Zone) => z.edits * 2 + z.reads + z.fails * 3
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8)

function agentFor(id: string | undefined, name?: string): Agent | undefined {
  if (id === undefined) return undefined
  const known = agents.get(id) ?? { index: agents.size, name: `agent ${agents.size + 1}`, reads: 0, edits: 0, last: '' }
  if (name) known.name = name
  agents.set(id, known)
  return known
}

function clear() {
  hits.clear()
  touched.clear()
  agents.clear()
  zones.clear()
  feed.length = 0
  fails = 0
}

async function bump($: EngineInterface, force = false) {
  const now = await $.clock.now()
  if (!force && now - lastBump < 200) return
  lastBump = now
  await update($, version, v => v + 1)
}

async function loadRepo($: EngineInterface) {
  const cwd = await $.session.cwd()
  const git = (args: string[], at = cwd) => $.process.run(['git', '-C', at, ...args], { timeoutMs: 10_000 }).catch(() => undefined)
  const top = await git(['rev-parse', '--show-toplevel'])
  isGit = top?.exitCode === 0
  root = isGit ? top!.stdout.trim() : cwd
  repoName = root.split('/').filter(Boolean).pop() ?? root
  const head = isGit ? await git(['rev-parse', '--abbrev-ref', 'HEAD'], root) : undefined
  branch = head?.exitCode === 0 ? head.stdout.trim() : ''
  const files = isGit ? await git(['ls-files'], root) : undefined
  const paths = files?.exitCode === 0 ? files.stdout.split('\n').filter(Boolean) : []
  tree = buildTree(paths)
  fileCount = paths.length
  treeVersion += 1
}

async function record($: EngineInterface, rawPath: string, kind: Kind, agentId: string | undefined) {
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
  const agent = agentFor(agentId)
  if (agent) {
    if (kind === 'edit') agent.edits += 1
    else if (kind === 'read') agent.reads += 1
    agent.last = zoneOf(path)
  }
  const index = agent?.index ?? -1
  hits.delete(path)
  hits.set(path, { kind, agent: index, at: now })
  if (hits.size > 600) hits.delete(hits.keys().next().value!)
  if (kind === 'error') fails += 1
  else if (touched.get(path) !== 'edit') touched.set(path, kind)
  const zone = zones.get(zoneOf(path)) ?? { reads: 0, edits: 0, fails: 0, at: 0 }
  zones.set(zoneOf(path), { reads: zone.reads + (kind === 'read' ? 1 : 0), edits: zone.edits + (kind === 'edit' ? 1 : 0), fails: zone.fails + (kind === 'error' ? 1 : 0), at: now })
  feed.unshift({ kind, path, agent: index, at: now })
  feed.length = Math.min(feed.length, 8)
  await bump($)
}

// columns: the dock's width beside a fullscreen transcript; rows: the inline seat above the prompt.
function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, columns: 64, rows: 8 })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'radar', description: 'Repo Radar: a live map of where Claude is working', argumentHint: '[reset]' })
    await loadRepo($).catch(() => undefined)
    if (options.openOnStart !== false) openPane($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'radar' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      clear()
      await loadRepo($).catch(() => undefined)
      await bump($, true)
      return { text: 'Radar cleared.' }
    }
    await openPane($)
    return {}
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    await bump($, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      isWorking = false
      await bump($, true)
    }
    return done
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId) {
      agentFor(started.agentId, e.subagentType.split(':').pop())
      await bump($, true)
    }
    return started
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
    const stamp = await read($, version)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const W = Math.max(36, e.props.bodyColumns ?? 64)
    const inner = W - 4
    const isCompact = (e.viewport?.rows ?? 40) < 18
    const edits = [...touched.values()].filter(k => k === 'edit').length
    const hot = [...zones].sort((a, b) => heat(b[1]) - heat(a[1])).slice(0, 5)
    const hotMax = Math.max(1, ...hot.map(([, z]) => heat(z)))
    const zoneColor = (z: Zone) => hex(z.fails ? COLORS.error : z.edits ? COLORS.edit : COLORS.read)
    const agentName = (index: number) => [...agents.values()].find(a => a.index === index)?.name

    const status = isWorking ? <Text color={C.main} bold>● scanning</Text> : <Text color={C.dim}>○ idle</Text>
    const panel = (color: string, title: string, right: RenderChildren, body: RenderChildren) => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={W}>
        <Box justifyContent="space-between">
          <Text color={color} bold>{title}</Text>
          {right}
        </Box>
        {body}
      </Box>
    )
    const event = (ev: (typeof feed)[number], withTime: boolean) => (
      <Text wrap="truncate">
        {withTime && <Text color={C.dim}>{clock(ev.at)} </Text>}
        <Text color={hex(glowColor(ev))} bold>{VERB[ev.kind].padEnd(5)}</Text>
        <Text> {ev.path}</Text>
        {ev.agent >= 0 && <Text color={hex(agentColor(ev.agent))}> · {agentName(ev.agent)}</Text>}
      </Text>
    )
    const counts = (
      <Text wrap="truncate">
        <Text color={C.dim}>touched </Text>
        <Text color={C.main}>{gauge(fileCount ? touched.size / fileCount : 0)} </Text>
        <Text bold>{touched.size}</Text>
        <Text color={C.dim}> · </Text>
        <Text color={hex(COLORS.edit)} bold>{edits}</Text>
        <Text color={C.dim}> edited · </Text>
        <Text color={fails ? hex(COLORS.error) : C.dim} bold={fails > 0}>{fails}</Text>
        <Text color={C.dim}> failed</Text>
      </Text>
    )

    // Seated inline above the prompt: the summary, the hottest folders, the latest event.
    if (isCompact) {
      return panel(C.main, '◉ REPO RADAR', status, (
        <Box flexDirection="column">
          {counts}
          <Text wrap="truncate">
            {hot.length === 0 && <Text color={C.dim}>no activity yet</Text>}
            {hot.slice(0, 3).map(([zone, z], i) => (
              <Text>
                {i > 0 && <Text>  </Text>}
                <Text>{zone} </Text>
                <Text color={zoneColor(z)}>{gauge(heat(z) / hotMax, 4)}</Text>
              </Text>
            ))}
          </Text>
          {feed[0] ? event(feed[0], false) : <Text color={C.dim}>waiting for Claude to touch a file…</Text>}
        </Box>
      ))
    }

    const mapRows = Math.max(8, Math.min(28, (e.viewport?.rows ?? 40) - 24 - hot.length - (agents.size ? agents.size + 3 : 0)))
    const mapProps: MapProps = {
      tree: treeData(tree),
      treeVersion,
      hits: [...hits].filter(([, h]) => now - h.at < GLOW_WINDOW_MS).slice(-200).map(([path, h]) => [path, h.kind, h.agent, now - h.at]),
      tints: [...touched].slice(-400),
      columns: inner,
      rows: mapRows,
      stamp,
    }
    const sweepProps: SweepProps = { isActive: isWorking, width: W, trail: SWEEP_TRAIL, dim: hex(mix(COLORS.headerText, COLORS.dark, 0.55)) }

    let map: RenderChildren
    let sweep: (key: string) => RenderChildren
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      map = <Client key="map" module="./map.tsx" width={inner} height={mapRows} props={mapProps} />
      sweep = key => <Client key={key} module="./sweep.tsx" width={W} height={1} props={sweepProps} />
    } else {
      map = <Text color={C.dim}>The live map draws in the terminal and the desktop app.</Text>
      sweep = () => <Text color={C.faint}>{'─'.repeat(W)}</Text>
    }

    const legend = (
      <Text>
        <Text color={hex(COLORS.read)}>■</Text>
        <Text color={C.dim}> read </Text>
        <Text color={hex(COLORS.edit)}>■</Text>
        <Text color={C.dim}> edit </Text>
        <Text color={hex(COLORS.error)}>■</Text>
        <Text color={C.dim}> fail</Text>
      </Text>
    )
    const zoneWidth = Math.max(12, inner - 26)

    return (
      <Box flexDirection="column">
        {panel(C.main, '◉ REPO RADAR', status, (
          <Box flexDirection="column">
            <Text wrap="truncate">
              <Text bold>{repoName}</Text>
              {branch && <Text color={C.dim}> · {branch}</Text>}
              <Text color={C.dim}> · {fileCount.toLocaleString('en-US')} files{isGit ? '' : ' · not a git repo'}</Text>
            </Text>
            {counts}
          </Box>
        ))}
        {sweep('sweep-map')}
        {panel(C.map, 'MAP', legend, map)}
        {agents.size > 0 && sweep('sweep-agents')}
        {agents.size > 0 && panel(C.agents, 'AGENTS', <Text color={C.dim}>{agents.size}</Text>, (
          <Box flexDirection="column">
            {[...agents.values()].map(a => (
              <Text wrap="truncate">
                <Text color={hex(agentColor(a.index))}>■ </Text>
                <Text bold>{a.name.padEnd(14).slice(0, 14)}</Text>
                <Text color={C.dim}> {a.reads} read · </Text>
                <Text color={hex(agentColor(a.index))}>{a.edits} edit</Text>
                {a.last && <Text color={C.dim}> · {a.last}</Text>}
              </Text>
            ))}
          </Box>
        ))}
        {panel(C.zones, 'HOT ZONES', <Text color={C.dim}>{zones.size} folders</Text>, (
          <Box flexDirection="column">
            {hot.length === 0 && <Text color={C.dim}>Nothing yet. Folders Claude works in rank here.</Text>}
            {hot.map(([zone, z]) => (
              <Text wrap="truncate">
                <Text color={zoneColor(z)}>{gauge(heat(z) / hotMax, 8)} </Text>
                <Text>{zone.padEnd(zoneWidth).slice(0, zoneWidth)}</Text>
                <Text color={C.dim}> {z.reads}r </Text>
                <Text color={hex(COLORS.edit)}>{z.edits}e</Text>
                {z.fails > 0 && <Text color={hex(COLORS.error)}> {z.fails}✗</Text>}
              </Text>
            ))}
          </Box>
        ))}
        {panel(C.feed, 'FEED', <Text color={C.dim}>/radar reset</Text>, (
          <Box flexDirection="column">
            {feed.length === 0 && <Text color={C.dim}>Waiting for Claude to touch a file…</Text>}
            {feed.slice(0, 6).map(ev => event(ev, true))}
          </Box>
        ))}
      </Box>
    )
  })
}
