import { expect, mock, test } from 'claude-code/testing'

import { buildTree, fromData, intensity, layout, mix, paint, squarify, tileFor, treeData } from '../hooks/layout'
import { gauge, relative } from '../hooks/register'

const PATHS = [
  'README.md', 'package.json',
  ...Array.from({ length: 40 }, (_, i) => `src/api/route${i}.ts`),
  ...Array.from({ length: 25 }, (_, i) => `src/auth/f${i}.ts`),
  ...Array.from({ length: 10 }, (_, i) => `src/ui/c${i}.tsx`),
  ...Array.from({ length: 30 }, (_, i) => `tests/t${i}.ts`),
  ...Array.from({ length: 20 }, (_, i) => `docs/guide/p${i}.md`),
  ...Array.from({ length: 30 }, (_, i) => `pkg${i}/index.ts`),
]

test('squarify fills the rectangle exactly', () => {
  const out = squarify([{ key: 'a', label: 'a', weight: 6 }, { key: 'b', label: 'b', weight: 3 }, { key: 'c', label: 'c', weight: 1 }], { x: 0, y: 0, w: 10, h: 6 })
  expect(Math.abs(out.reduce((s, r) => s + r.w * r.h, 0) - 60) < 1e-6).toBe(true)
  for (const r of out) expect(r.x + r.w).toBeLessThanOrEqual(10 + 1e-9)
})

test('tiles stay in bounds and never overlap', () => {
  const tiles = layout(buildTree(PATHS), 70, 20)
  const seen = new Set<string>()
  for (const t of tiles) {
    expect(t.x0).toBeGreaterThanOrEqual(0)
    expect(t.x1).toBeLessThanOrEqual(70)
    expect(t.y1).toBeLessThanOrEqual(20)
    for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) {
      expect(seen.has(`${x},${y}`)).toBe(false)
      seen.add(`${x},${y}`)
    }
  }
  expect(tiles.some(t => t.key === 'src' && t.isHeader)).toBe(true)
  expect(tiles.some(t => t.key === 'src/api')).toBe(true)
  // 32 top-level entries collapse to 11 plus an overflow tile.
  expect(tiles.filter(t => !t.key.includes('/')).length).toBeLessThanOrEqual(12)
})

test('paths map to their folder tile, overflow, or the top folder', () => {
  const tiles = layout(buildTree(PATHS), 70, 20)
  expect(tileFor(tiles, 'src/auth/f3.ts')?.key).toBe('src/auth')
  expect(tileFor(tiles, 'src')?.key).toBe('src')
  expect(tileFor(tiles, 'pkg29/index.ts')?.key).toMatch(/^(pkg29|…)$/)
  expect(relative('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
  expect(relative('/elsewhere/a.ts', '/repo')).toBeUndefined()
  expect(relative('./src/', '/repo')).toBe('src')
})

test('heat fades, colors mix, rows paint to full width', () => {
  const hit = { kind: 'edit' as const, agent: -1, at: 0 }
  expect(intensity(hit, 0)).toBeGreaterThan(0.9)
  expect(intensity(hit, 60_000)).toBe(0)
  expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080)
  expect(gauge(0.25, 8)).toBe('▰▰▱▱▱▱▱▱')
  const tree = buildTree(PATHS)
  expect(fromData(treeData(tree)).get('src')?.children.get('api')).toBe(40)
  const rows = paint(layout(tree, 40, 10), 40, 10, () => ({ bg: 0x123456, glow: 0 }))
  expect(rows).toHaveLength(10)
  for (const runs of rows) expect(runs.map(r => r.text).join('')).toHaveLength(40)
  expect(rows.flat().some(r => r.text.includes('src/'))).toBe(true)
})

test('a read lights the map on terminal and desktop', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', ($, e) => {
    const argv = (e as { argv: string[] }).argv
    return { value: { exitCode: 0, stdout: argv.includes('ls-files') ? PATHS.join('\n') : '/repo\n', stderr: '' } as never }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} as never }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth/f1.ts' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'repo-radar', surface, component: 'Pane', requestId: 'radar', props: { bodyColumns: 70 } as never, viewport: { columns: 80, rows: 48 } as never })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('"type":"Client"')
    expect(drawn).toContain('HOT ZONES')
    expect(drawn).toContain('src/auth/f1.ts')
    const map = JSON.stringify(await ui.drawn({ in: 'map' }))
    expect(map).toContain('backgroundColor')
    expect(map).toContain(' src/')
    await ui.unmount()
  }
  // Seated inline: one compact panel.
  const inline = await $.ui.mount({ plugin: 'repo-radar', surface: 'terminal', component: 'Pane', requestId: 'radar', props: { bodyColumns: 70 } as never, viewport: { columns: 80, rows: 8 } as never })
  const compact = JSON.stringify(await inline.drawn())
  expect(compact).not.toContain('HOT ZONES')
  expect(compact).toContain('src/auth')
})
