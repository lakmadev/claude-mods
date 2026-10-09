import { expect, test } from 'claude-code/testing'

import { record } from '../hooks/register'

test('sums repeat edits and moves the file to the top', () => {
  let list = record([], 'a.ts', 3, 1)
  list = record(list, 'b.ts', 10, 0)
  list = record(list, 'a.ts', 2, 2)
  expect(list).toEqual([
    { path: 'a.ts', added: 5, removed: 3, edits: 2 },
    { path: 'b.ts', added: 10, removed: 0, edits: 1 },
  ])
})

test('records successful edits and draws them in the pane', async ($, on) => {
  on('tool.call', () => ({ result: {} as never }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y\nz' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'changes-pane', surface, component: 'Pane', requestId: 'changes', props: {} as never })
    expect((await ui.find({ text: '+2' }))).toBeDefined()
  }
})
