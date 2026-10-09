import type { EngineInterface, Register } from 'claude-code'

export type Entry = { at: number; project: string; prompt: string; files: string[]; seconds: number }

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

// Local calendar day, so "yesterday" means what the user thinks it means.
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `day:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Monday's standup covers Friday onwards.
export const standupDays = (ms: number) => (new Date(ms).getDay() === 1 ? 3 : 1)

export function formatEntries(entries: readonly Entry[]): string {
  if (entries.length === 0) return 'Nothing logged.'
  let lastDay = ''
  const lines: string[] = []
  for (const entry of entries) {
    const d = new Date(entry.at)
    const day = d.toDateString()
    if (day !== lastDay) lines.push(`\n${day}`)
    lastDay = day
    const files = entry.files.length ? ` (${entry.files.length} file${entry.files.length === 1 ? '' : 's'})` : ''
    lines.push(`  ${pad(d.getHours())}:${pad(d.getMinutes())}  ${entry.project}  ${entry.prompt.split('\n')[0]!.slice(0, 90)}${files}`)
  }
  return lines.join('\n').trim()
}

async function entriesSince($: EngineInterface, days: number): Promise<Entry[]> {
  const now = await $.clock.now()
  const out: Entry[] = []
  for (let back = days; back >= 0; back--) {
    out.push(...(((await $.store.get(dayKey(now - back * DAY_MS))) as Entry[] | undefined) ?? []))
  }
  return out
}

export const register: Register = (on, options) => {
  const retentionMs = Number(options.retentionDays ?? 30) * DAY_MS
  let current: { prompt: string; files: Set<string> } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'journal', description: 'Show what you worked on with Claude', argumentHint: '[days]' })
    await $.command.register({ name: 'standup', description: 'Write a standup update from your journal', argumentHint: '[days]' })
    const cutoff = dayKey((await $.clock.now()) - retentionMs)
    for (const key of await $.store.keys()) {
      if (key.startsWith('day:') && key < cutoff) await $.store.delete(key)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn starts inside the main one; keep the main turn's prompt.
    current ??= { prompt: e.text, files: new Set() }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = 'file_path' in e && ['Edit', 'Write'].includes(String(e.tool)) ? e.file_path : undefined
    if (current && typeof path === 'string' && ran.deny === undefined && !ran.isError) current.files.add(path)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || !current) return done
    const now = await $.clock.now()
    const cwd = await $.session.cwd()
    const entry: Entry = {
      at: now,
      project: cwd.split('/').filter(Boolean).pop() ?? cwd,
      prompt: current.prompt.slice(0, 300),
      files: [...current.files].slice(0, 20),
      seconds: Math.round(e.durationMs / 1000),
    }
    current = undefined
    const key = dayKey(now)
    const day = ((await $.store.get(key)) as Entry[] | undefined) ?? []
    // ponytail: read-modify-write; two sessions finishing in the same instant can drop one entry.
    await $.store.set(key, [...day, entry].slice(-500))
    return done
  })

  on('command.run', { command: 'journal' }, async ($, e) => {
    const days = Math.max(0, Number.parseInt(e.args, 10) || 0)
    return { text: formatEntries(await entriesSince($, days)) }
  })

  on('command.run', { command: 'standup' }, async ($, e) => {
    const days = Number.parseInt(e.args, 10) || standupDays(await $.clock.now())
    const entries = await entriesSince($, days)
    if (entries.length === 0) return { text: 'Nothing in the journal to report yet.' }
    const reply = await $.model.complete({
      model: String(options.model ?? 'haiku'),
      maxTokens: 800,
      timeoutMs: 60_000,
      system: 'You write concise engineering standup updates in plain text.',
      prompt: `From this log of my coding-assistant sessions, write a standup update with three short sections: "Done", "In progress", "Blockers" (write "None" if nothing suggests one). Group by project, merge related prompts into one bullet, and describe outcomes rather than prompts. No preamble.\n\n${formatEntries(entries)}`,
    })
    return { text: reply.isAnswered ? reply.text : `Could not write the standup (${reply.reason}). Raw log:\n\n${formatEntries(entries)}` }
  })
}
