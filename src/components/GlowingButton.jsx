import styled, { css, keyframes } from 'styled-components'

const rainbowShift = keyframes`
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 200% 50%;
  }
`

const starMovementBottom = keyframes`
  0% {
    transform: translate(0%, 0%);
    opacity: 1;
  }
  100% {
    transform: translate(-100%, 0%);
    opacity: 0;
  }
`

const starMovementTop = keyframes`
  0% {
    transform: translate(0%, 0%);
    opacity: 1;
  }
  100% {
    transform: translate(100%, 0%);
    opacity: 0;
  }
`

/** Loading sweep: keep strips visible (no fade to black) so the border stays vivid */
const rainbowSweepBottom = keyframes`
  0% {
    transform: translate(0%, 0%);
    opacity: 1;
  }
  100% {
    transform: translate(-100%, 0%);
    opacity: 0.62;
  }
`

const rainbowSweepTop = keyframes`
  0% {
    transform: translate(0%, 0%);
    opacity: 1;
  }
  100% {
    transform: translate(100%, 0%);
    opacity: 0.62;
  }
`

/** Saturated stops - idle / non-conic-ring rainbow (legacy sweep layers) */
const RAINBOW_BORDER_GRADIENT = `linear-gradient(
  90deg,
  #ff3366 0%,
  #ff9f1c 11%,
  #ffea00 22%,
  #06ffa5 33%,
  #00d4ff 44%,
  #a855f7 55%,
  #f472b6 66%,
  #ff3366 78%,
  #06ffa5 89%,
  #ff3366 100%
)`

/**
 * Rotating rainbow border - same technique as common CSS tutorials (oversized gradient layer + overflow clip + padded inner).
 * Transform keeps translate(-50%,-50%) so rotation stays centered on the button.
 */
const conicSpin = keyframes`
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
`

const RainbowBorderTrack = styled.div`
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
`

const RainbowBorderRotate = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(280%, 520px);
  height: max(280%, 520px);
  transform: translate(-50%, -50%);
  border-radius: 0;
  /* Fully saturated spectrum (HSL) - continuous ring; spin only while $spin */
  background: conic-gradient(
    from 0deg,
    hsl(330 100% 52%),
    hsl(0 100% 55%),
    hsl(32 100% 54%),
    hsl(55 100% 50%),
    hsl(95 100% 48%),
    hsl(150 100% 45%),
    hsl(185 100% 48%),
    hsl(220 100% 58%),
    hsl(265 100% 58%),
    hsl(305 100% 55%),
    hsl(330 100% 52%)
  );
  animation: ${props =>
    props.$spin ? css`${conicSpin} 0.8s linear infinite` : 'none'};
  will-change: ${props => (props.$spin ? 'transform' : 'auto')};
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const StyledButton = styled.button`
  position: relative;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
  overflow: hidden;
  border: none;
  background: ${props =>
    props.$rainbowGutter || props.$vividRing ? 'transparent' : undefined};
  /* Rainbow: ring thickness = padding; gradient shows only in this gutter (inner covers centre) */
  padding: ${props => (props.$vividRing || props.$rainbowGutter ? '3px' : '1px 0')};
  border-radius: 9999px;
  max-width: 100%;
  isolation: isolate;
  /* Same min/max/width so label weight changes cannot resize the control (flex min-content) */
  ${props =>
    props.$scanLockCh != null &&
    css`
      width: min(100%, ${props.$scanLockCh}ch);
      min-width: min(100%, ${props.$scanLockCh}ch);
      max-width: min(100%, ${props.$scanLockCh}ch);
      flex-shrink: 0;
      flex-grow: 0;
    `}
  /* One glow for all rainbow states - avoids visible "growth" when scan starts */
  ${props =>
    props.$rainbowGutter &&
    css`
      box-shadow:
        0 0 26px rgba(255, 40, 140, 0.72),
        0 0 50px rgba(0, 230, 255, 0.52),
        0 0 5px rgba(255, 255, 255, 0.44);
    `}
  cursor: ${props =>
    props.$loading ? 'wait' : props.disabled ? 'not-allowed' : 'pointer'};
  transition: opacity 0.25s ease, transform 0.3s ease;
  /* Running scan: stay fully vivid; generic disabled stays muted */
  opacity: ${props =>
    props.$loading ? 1 : props.disabled ? 0.5 : 1};
  
  &:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  
  &:active:not(:disabled) {
    transform: translateY(0);
  }
  
  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.5);
    outline-offset: 4px;
  }
`

const ButtonContent = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  line-height: 1.5rem;
  font-weight: ${props =>
    props.$rainbowGutter || props.$loading ? 600 : 500};
  color: #e5e7eb;
  background: rgba(31, 41, 55, 0.6);
  backdrop-filter: blur(10px);
  ${props =>
    props.$rainbowGutter &&
    css`
      background: #1a1f2e;
      backdrop-filter: none;
    `}
  ${props =>
    props.$scanLock &&
    css`
      min-height: 3rem;
    `}
  /* inner border */
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 9999px;
  
  /* Glassy effect */
  box-shadow: 
    0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);

  ${props =>
    props.$rainbowGutter &&
    props.$loading &&
    css`
      flex-wrap: nowrap;
      white-space: nowrap;
      background: #1a1f2e;
      border-color: rgba(255, 255, 255, 0.42);
      box-shadow:
        0 0 0 1px rgba(200, 160, 255, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.12),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35);
    `}

  ${props =>
    props.$loading &&
    !props.$rainbowGutter &&
    css`
      flex-wrap: nowrap;
      white-space: nowrap;
      backdrop-filter: none;
      background: linear-gradient(
        145deg,
        rgba(28, 22, 42, 0.97) 0%,
        rgba(18, 20, 36, 0.98) 50%,
        rgba(14, 16, 30, 0.99) 100%
      );
      border-color: rgba(255, 255, 255, 0.42);
      box-shadow:
        0 0 0 1px rgba(200, 160, 255, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.12),
        inset 0 -1px 0 rgba(0, 0, 0, 0.35);
    `}

  /* Hover border accent to match reference graphic */
  &:hover {
    ${props =>
      props.$rainbowGutter
        ? css`
            border-color: rgba(255, 255, 255, 0.35);
            background: #232838;
            box-shadow:
              0 0 0 1px rgba(255, 255, 255, 0.14),
              inset 0 1px 0 rgba(255, 255, 255, 0.1),
              inset 0 -1px 0 rgba(0, 0, 0, 0.28);
          `
        : css`
            border-color: #f5b97a; /* warm peach/orange */
            background: linear-gradient(135deg, rgba(50, 50, 50, 0.9) 0%, rgba(24, 24, 24, 0.9) 100%);
            box-shadow:
              0 0 0 1px rgba(245, 185, 122, 0.6),
              0 0 12px rgba(245, 185, 122, 0.25),
              inset 0 1px 0 rgba(255, 255, 255, 0.12),
              inset 0 -1px 0 rgba(0, 0, 0, 0.2);
          `}
  }
`

/** Wraps loading label so animated rainbow text clips cleanly (single gradient layer). */
const RainbowLoadingText = styled.span`
  display: block;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  text-align: center;
  line-height: 1.5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(
    90deg,
    #ff5f6d 0%,
    #ffc371 14%,
    #fff36b 28%,
    #63ffa2 42%,
    #56ccf2 57%,
    #6c63ff 71%,
    #ff5fcd 85%,
    #ff5f6d 100%
  );
  background-size: 280% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ${rainbowShift} 2.2s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    background-position: 40% 50%;
  }
`

const StarBottom = styled.div`
  position: absolute;
  width: 150%;
  height: ${props => (props.$loading ? '42%' : '25%')};
  opacity: ${props => {
    if (props.$borderVariant !== 'rainbow') return props.$loading ? 0.85 : 0.7
    return props.$loading ? 1 : 0.95
  }};
  filter: ${props =>
    props.$loading && props.$borderVariant === 'rainbow'
      ? 'drop-shadow(0 0 14px rgba(255, 60, 160, 0.85)) drop-shadow(0 0 26px rgba(0, 220, 255, 0.55)) saturate(1.25)'
      : 'none'};
  bottom: ${props => (props.$loading ? '-13px' : '-11px')};
  right: -125%;
  border-radius: 9999px;
  background: ${props =>
    props.$borderVariant === 'rainbow'
      ? props.$loading
        ? RAINBOW_BORDER_GRADIENT
        : 'linear-gradient(90deg, #ff5f6d 0%, #ffc371 16%, #fff36b 32%, #63ffa2 48%, #56ccf2 64%, #6c63ff 80%, #ff5fcd 100%)'
      : 'radial-gradient(circle, white, transparent 10%)'};
  background-size: ${props =>
    props.$borderVariant === 'rainbow'
      ? props.$loading
        ? '240% 100%'
        : '200% 100%'
      : '100% 100%'};
  animation: ${props =>
    props.$borderVariant === 'rainbow'
      ? props.$loading
        ? css`${rainbowSweepBottom} 2.6s linear infinite alternate, ${rainbowShift} 1.35s linear infinite`
        : css`${starMovementBottom} 5s linear infinite alternate, ${rainbowShift} 3s linear infinite`
      : css`${starMovementBottom} 5s linear infinite alternate`};
  z-index: 0;
  pointer-events: none;

  @media (prefers-reduced-motion: reduce) {
    animation: ${props =>
      props.$borderVariant === 'rainbow' && props.$loading
        ? css`${rainbowShift} 4s linear infinite`
        : 'none'};
    opacity: ${props =>
      props.$borderVariant === 'rainbow' ? (props.$loading ? 1 : 0.92) : 0.75};
    filter: ${props =>
      props.$loading && props.$borderVariant === 'rainbow'
        ? 'drop-shadow(0 0 12px rgba(255, 80, 180, 0.7)) saturate(1.2)'
        : 'none'};
  }
`

const StarTop = styled.div`
  position: absolute;
  width: 150%;
  height: ${props => (props.$loading ? '42%' : '25%')};
  opacity: ${props => {
    if (props.$borderVariant !== 'rainbow') return props.$loading ? 0.85 : 0.7
    return props.$loading ? 1 : 0.95
  }};
  filter: ${props =>
    props.$loading && props.$borderVariant === 'rainbow'
      ? 'drop-shadow(0 0 14px rgba(0, 230, 255, 0.75)) drop-shadow(0 0 26px rgba(180, 90, 255, 0.45)) saturate(1.25)'
      : 'none'};
  top: ${props => (props.$loading ? '-12px' : '-10px')};
  left: -125%;
  border-radius: 9999px;
  background: ${props =>
    props.$borderVariant === 'rainbow'
      ? props.$loading
        ? RAINBOW_BORDER_GRADIENT
        : 'linear-gradient(90deg, #ff5f6d 0%, #ffc371 16%, #fff36b 32%, #63ffa2 48%, #56ccf2 64%, #6c63ff 80%, #ff5fcd 100%)'
      : 'radial-gradient(circle, white, transparent 10%)'};
  background-size: ${props =>
    props.$borderVariant === 'rainbow'
      ? props.$loading
        ? '240% 100%'
        : '200% 100%'
      : '100% 100%'};
  animation: ${props =>
    props.$borderVariant === 'rainbow'
      ? props.$loading
        ? css`${rainbowSweepTop} 2.6s linear infinite alternate, ${rainbowShift} 1.35s linear infinite reverse`
        : css`${starMovementTop} 5s linear infinite alternate, ${rainbowShift} 3s linear infinite reverse`
      : css`${starMovementTop} 5s linear infinite alternate`};
  z-index: 0;
  pointer-events: none;

  @media (prefers-reduced-motion: reduce) {
    animation: ${props =>
      props.$borderVariant === 'rainbow' && props.$loading
        ? css`${rainbowShift} 4s linear infinite reverse`
        : 'none'};
    opacity: ${props =>
      props.$borderVariant === 'rainbow' ? (props.$loading ? 1 : 0.92) : 0.75};
    filter: ${props =>
      props.$loading && props.$borderVariant === 'rainbow'
        ? 'drop-shadow(0 0 12px rgba(100, 200, 255, 0.65)) saturate(1.2)'
        : 'none'};
  }
`

function GlowingButton({
  children,
  disabled,
  onClick,
  type = 'button',
  className,
  'aria-label': ariaLabel,
  fullWidth,
  borderVariant,
  title,
  /** Scan running / busy: full-opacity rainbow (disabled alone dims the whole control). */
  loading = false,
  /** Lock width to min(100%, N ch) so idle <-> loading never changes horizontal size. */
  scanLockCh = null,
  ...props
}) {
  const vividRing = Boolean(loading && borderVariant === 'rainbow')
  const rainbowGutter = borderVariant === 'rainbow'
  const scanLockStyle =
    scanLockCh != null
      ? {
          width: `min(100%, ${scanLockCh}ch)`,
          minWidth: `min(100%, ${scanLockCh}ch)`,
          maxWidth: `min(100%, ${scanLockCh}ch)`,
        }
      : undefined
  /** Full conic ring for every rainbow state - never the old top/bottom "star" strips (they read as two disconnected bars). */
  const useConicRainbow = rainbowGutter

  const button = (
    <StyledButton
      type={type}
      disabled={disabled}
      $loading={loading}
      $vividRing={vividRing}
      $rainbowGutter={rainbowGutter}
      $scanLockCh={scanLockCh}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
      style={fullWidth ? { width: '100%' } : undefined}
      {...props}
      title={disabled ? undefined : title}
    >
      {useConicRainbow ? (
        <RainbowBorderTrack aria-hidden="true">
          <RainbowBorderRotate $spin={loading} />
        </RainbowBorderTrack>
      ) : (
        <>
          <StarBottom $borderVariant={borderVariant} $loading={loading} />
          <StarTop $borderVariant={borderVariant} $loading={loading} />
        </>
      )}
      <ButtonContent
        $loading={loading}
        $rainbowGutter={rainbowGutter}
        $scanLock={scanLockCh != null}
      >
        {loading && borderVariant === 'rainbow' ? (
          <RainbowLoadingText>{children}</RainbowLoadingText>
        ) : (
          children
        )}
      </ButtonContent>
    </StyledButton>
  )

  if (title && disabled) {
    return (
      <span
        className="inline-flex max-w-full shrink-0 justify-center"
        style={scanLockStyle}
        title={title}
      >
        {button}
      </span>
    )
  }

  return button
}

export default GlowingButton

