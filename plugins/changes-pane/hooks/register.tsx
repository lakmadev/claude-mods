import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Change } from '../types'

const PANE = 'changes'
const files = atom({ plugin: 'changes-pane', key: 'files' } as const, [])

const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length)

// Newest change first; a file edited again moves to the top with its counts summed.
export function record(list: readonly Change[], path: string, added: number, removed: number): Change[] {
  const before = list.find(one => one.path === path)
  const merged: Change = {
    path,
    added: (before?.added ?? 0) + added,
    removed: (before?.removed ?? 0) + removed,
    edits: (before?.edits ?? 0) + 1,
  }
  return [merged, ...list.filter(one => one.path !== path)].slice(0, 500)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'changes', description: 'Show the files Claude changed this session' })
    return next(e)
  })

  on('command.run', { command: 'changes' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Changed files' })
    const list = await read($, files)
    return { text: `${list.length} file(s) changed this session.` }
  })

  // Each file tool: run the call, record it only if it went through.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const isFirst = (await read($, files)).length === 0
    await update($, files, list => record(list, e.file_path, lineCount(e.new_string), lineCount(e.old_string)))
    if (isFirst && options.autoOpen !== false) $.ui.open({ id: PANE, title: 'Changed files' }).catch(() => undefined)
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const isFirst = (await read($, files)).length === 0
    await update($, files, list => record(list, e.file_path, lineCount(e.content), 0))
    if (isFirst && options.autoOpen !== false) $.ui.open({ id: PANE, title: 'Changed files' }).catch(() => undefined)
    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    await update($, files, list => record(list, e.notebook_path, lineCount(e.new_source), 0))
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const cwd = await $.session.cwd()
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const added = list.reduce((sum, one) => sum + one.added, 0)
    const removed = list.reduce((sum, one) => sum + one.removed, 0)

    if (list.length === 0) return <Text dimColor>No files changed yet this session.</Text>

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>{list.length} files</Text>
          <Text color="diffAdded">+{added}</Text>
          <Text color="diffRemoved">-{removed}</Text>
        </Box>
        {list.slice(0, room).map(one => (
          <Box gap={1}>
            <Text color="diffAdded">+{one.added}</Text>
            <Text color="diffRemoved">-{one.removed}</Text>
            <Text wrap="truncate-start">{one.path.startsWith(cwd + '/') ? one.path.slice(cwd.length + 1) : one.path}</Text>
          </Box>
        ))}
        {list.length > room && <Text dimColor>…and {list.length - room} more</Text>}
        <Button key="clear" label="Clear" onPress={() => update($, files, () => [])} />
      </Box>
    )
  })
}
