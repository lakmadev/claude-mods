// A connector between panels: while Claude works, a radar blip sweeps along it with a fading trail;
// idle, it rests as a dim line. Only this region redraws.
import type { ClientModule } from 'claude-code'

export type SweepProps = { isActive: boolean; width: number; trail: string[]; dim: string }

type Ref = { phase: number; isActive: boolean }
type State = { ref: Ref }

const STEP_MS = 70

const Sweep: ClientModule<SweepProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, isActive: props.isActive }
  ref.isActive = props.isActive
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (!ref.isActive) return
      ref.phase += 1
      surface.setState({ ref })
    })
  }

  const width = Math.max(1, surface.columns || props.width)
  if (!props.isActive) return <Text color={props.dim}>{'─'.repeat(width)}</Text>

  // The head runs left to right and wraps; the trail behind it steps down through the colours.
  const span = width + props.trail.length
  const head = ref.phase % span
  const runs: { text: string; color: string }[] = []
  for (let x = 0; x < width; x++) {
    const behind = head - x
    const color = behind >= 0 && behind < props.trail.length ? props.trail[behind]! : props.dim
    const glyph = behind === 0 ? '●' : behind > 0 && behind < props.trail.length ? '━' : '─'
    const last = runs[runs.length - 1]
    if (last && last.color === color) last.text += glyph
    else runs.push({ text: glyph, color })
  }
  return (
    <Box>
      {runs.map(run => (
        <Text color={run.color} bold={run.color !== props.dim}>
          {run.text}
        </Text>
      ))}
    </Box>
  )
}

export default Sweep
