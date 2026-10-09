import type { EngineInterface, PluginOptions, Register } from 'claude-code'

const TITLE = 'Claude Code'

export function finishedMessage(durationMs: number, answer: string): string {
  const seconds = Math.round(durationMs / 1000)
  const took = seconds >= 120 ? `${Math.round(seconds / 60)}m` : `${seconds}s`
  const firstLine = answer.trim().split('\n')[0] ?? ''
  const gist = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
  return gist ? `Done in ${took}: ${gist}` : `Done in ${took}`
}

// osascript reads the text from argv, so nothing needs escaping.
const MAC = ['osascript', '-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run']

let hasDesktop = true

async function notify($: EngineInterface, options: PluginOptions, message: string, title = TITLE) {
  $.ui.toast(message)
  if (options.sound !== false) await $.audio.play({ asset: 'assets/chime.wav' }).catch(() => undefined)
  if (options.desktop === false || !hasDesktop) return
  const mac = await $.process.run([...MAC, message, title], { timeoutMs: 3000 }).catch(() => undefined)
  if (mac?.exitCode === 0) return
  const linux = await $.process.run(['notify-send', title, message], { timeoutMs: 3000 }).catch(() => undefined)
  hasDesktop = linux?.exitCode === 0
}

export const register: Register = (on, options) => {
  const minMs = Number(options.minSeconds ?? 30) * 1000

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted && e.durationMs >= minMs) {
      await notify($, options, finishedMessage(e.durationMs, e.answer))
    }
    return done
  })

  // Claude is waiting on a permission prompt, or has sat idle waiting for input.
  on('classic.Notification', async ($, e, next) => {
    const result = await next(e)
    await notify($, options, e.message, e.title)
    return result
  })
}
