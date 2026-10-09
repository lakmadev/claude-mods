import type { Register, SessionMeasureInput } from 'claude-code'

type Reading = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export function formatMeter({ context, rateLimits, cost }: Reading): string {
  const parts: string[] = []
  if (context.percent !== undefined) {
    parts.push(`ctx ${context.percent}% (${kilo(context.tokens ?? 0)}/${kilo(context.window)})`)
  }
  if (cost) parts.push(`$${cost.usd.toFixed(2)}`)
  for (const limit of rateLimits) {
    parts.push(`${LIMIT_NAMES[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
  }
  return parts.join(' · ')
}

// Warns once per crossing; a reading back under the threshold (after /compact, a window reset) re-arms it.
export function warnings(
  { context, rateLimits }: Reading,
  thresholds: { context: number; rateLimit: number },
  warned: Set<string>,
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
    const when = limit.resetsAt ? `, resets ${new Date(limit.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
    const name = LIMIT_NAMES[limit.kind] ?? limit.kind
    check(`rl:${limit.kind}`, limit.percentUsed, thresholds.rateLimit, `${name} usage limit at ${Math.round(limit.percentUsed)}%${when}.`)
  }
  return out
}

export const register: Register = (on, options) => {
  const thresholds = {
    context: Number(options.contextWarnPercent ?? 80),
    rateLimit: Number(options.rateLimitWarnPercent ?? 90),
  }
  const warned = new Set<string>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const reading = await $.session.usage()
    $.ui.status(formatMeter(reading) || undefined)
    for (const message of warnings(reading, thresholds, warned)) $.ui.toast(message)
    return started
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    $.ui.status(formatMeter(e) || undefined)
    for (const message of warnings(e, thresholds, warned)) $.ui.toast(message)
    return measured
  })
}
