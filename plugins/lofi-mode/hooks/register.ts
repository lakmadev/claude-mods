import type { EngineInterface, Register, Timer } from 'claude-code'

const NOW_PLAYING = ['♪ lo-fi beats to code to', '♪ chillhop for compilers', '♪ beats to refactor to', '♪ rainy-day debugging mix']

let isEnabled = true
let pending: Timer | undefined
let playing: AbortController | undefined

// Volume 0..1 maps onto the engine's gain 0..4, kept gentle.
export const gainFor = (volume: number) => Math.min(1, Math.max(0, volume)) * 1.5

async function start($: EngineInterface, gain: number) {
  if (playing || !isEnabled) return
  playing = new AbortController()
  $.ui.status(NOW_PLAYING[Math.floor(Math.random() * NOW_PLAYING.length)])
  await $.audio.play({ asset: 'assets/lofi.wav' }, { shouldLoop: true, gain, signal: playing.signal }).catch(() => undefined)
}

function stop($: EngineInterface) {
  pending?.cancel()
  pending = undefined
  playing?.abort()
  playing = undefined
  $.ui.status(undefined)
}

export const register: Register = (on, options) => {
  const gain = gainFor(Number(options.volume ?? 0.35))
  const delayMs = Number(options.delaySeconds ?? 4) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lofi', description: 'Toggle lo-fi beats while Claude works', argumentHint: '[on|off]' })
    isEnabled = ((await $.store.get('enabled')) as boolean | undefined) ?? true
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (isEnabled && !playing && !pending) pending = $.clock.after(delayMs, () => void start($, gain))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) stop($)
    return done
  })

  on('session.end', async ($, e, next) => {
    stop($)
    return next(e)
  })

  on('command.run', { command: 'lofi' }, async ($, e) => {
    const arg = e.args.trim()
    isEnabled = arg === 'on' ? true : arg === 'off' ? false : !isEnabled
    await $.store.set('enabled', isEnabled)
    if (!isEnabled) stop($)
    return { text: isEnabled ? '♪ lo-fi mode on: beats start when Claude works for a while.' : 'lo-fi mode off.' }
  })
}
