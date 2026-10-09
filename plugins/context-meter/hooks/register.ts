import type { Register, SessionMeasureInput } from 'claude-code'

type Reading = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>
type Source = 'plan' | 'gateway' | 'api' | 'bedrock' | 'vertex' | 'foundry'

// A Claude plan meters usage in a rolling 5-hour window and a weekly one; a gateway may set a spend
// limit. Neither comes back on the API or a cloud provider, which bill per token instead.
const LIMIT_NAMES: Record<string, string> = { five_hour: '5h limit', seven_day: 'weekly', seven_day_opus: 'weekly (Opus)', spend_limit: 'spend limit' }
const SHORT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'week', seven_day_opus: 'week (Opus)', spend_limit: 'spend' }
const SOURCE_NAMES: Record<Source, string> = { plan: 'Claude plan', gateway: 'gateway', api: 'API', bedrock: 'Bedrock', vertex: 'Vertex AI', foundry: 'Foundry' }


// "1h52m", "38m", "3d4h": how long until a window resets.
export function resetIn(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return undefined
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
  const h = Math.round(m / 60)
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ''}`
}

export function sourceOf({ context, rateLimits }: Reading, provider: Source): Source | undefined {
  if (rateLimits.some(r => r.kind === 'five_hour' || r.kind.startsWith('seven_day'))) return 'plan'
  if (rateLimits.some(r => r.kind === 'spend_limit')) return 'gateway'
  return context.percent !== undefined ? provider : undefined
}

// "ctx 62% · 5h 85% resets 1h52m · week 40%": plain words and numbers, which read the same in any
// font (block gauges don't line up in the desktop's). A window's reset shows once it's past 70%.
// On a plan the $ is only an API-rate estimate, so it's left out; elsewhere it's the bill.
export function formatMeter({ context, rateLimits, cost }: Reading, source: Source | undefined, now: number): string {
  const parts: string[] = []
  if (context.percent !== undefined) parts.push(`ctx ${context.percent}%`)
  for (const limit of rateLimits) {
    const reset = limit.percentUsed >= 70 ? resetIn(limit.resetsAt, now) : undefined
    parts.push(`${SHORT_NAMES[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%${reset ? ` resets ${reset}` : ''}`)
  }
  if (cost && source && source !== 'plan') parts.push(`$${cost.usd.toFixed(2)} billed (${SOURCE_NAMES[source]})`)
  else if (cost && !source) parts.push(`$${cost.usd.toFixed(2)}`)
  return parts.join(' · ')
}

// Warns once per crossing; a reading back under the threshold (after /compact, a window reset) re-arms it.
export function warnings(
  { context, rateLimits }: Reading,
  thresholds: { context: number; rateLimit: number },
  warned: Set<string>,
  now = Date.now(),
): string[] {
  const out: string[] = []
  const check = (key: string, value: number, limit: number, message: string) => {
    if (value < limit) warned.delete(key)
    else if (!warned.has(key)) {
      warned.add(key)
      out.push(message)
    }
  }
  if (context.percent !== undefined) {
    check('ctx', context.percent, thresholds.context, `Context is ${context.percent}% full. Consider /compact or a fresh session.`)
  }
  for (const limit of rateLimits) {
    const reset = resetIn(limit.resetsAt, now)
    const name = LIMIT_NAMES[limit.kind] ?? limit.kind
    check(`rl:${limit.kind}`, limit.percentUsed, thresholds.rateLimit, `Your Claude plan's ${name} is at ${Math.round(limit.percentUsed)}%${reset ? `; it resets in ${reset}` : ''}.`)
  }
  return out
}

export const register: Register = (on, options) => {
  const thresholds = {
    context: Number(options.contextWarnPercent ?? 80),
    rateLimit: Number(options.rateLimitWarnPercent ?? 90),
  }
  const warned = new Set<string>()
  let provider: Source = 'api'
  let source: Source | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Which provider bills the tokens, from the switches Claude Code reads (never a key).
    if (await $.env.get('CLAUDE_CODE_USE_BEDROCK').catch(() => undefined)) provider = 'bedrock'
    else if (await $.env.get('CLAUDE_CODE_USE_VERTEX').catch(() => undefined)) provider = 'vertex'
    else if (await $.env.get('CLAUDE_CODE_USE_FOUNDRY').catch(() => undefined)) provider = 'foundry'
    const reading = await $.session.usage()
    const now = await $.clock.now()
    source = sourceOf(reading, provider) ?? source
    $.ui.status(formatMeter(reading, source, now) || undefined)
    for (const message of warnings(reading, thresholds, warned, now)) $.ui.toast(message)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const now = await $.clock.now()
    source = sourceOf(e, provider) ?? source
    $.ui.status(formatMeter(e, source, now) || undefined)
    for (const message of warnings(e, thresholds, warned, now)) $.ui.toast(message)
    return measured
  })
}
