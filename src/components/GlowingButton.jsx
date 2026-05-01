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

const StyledButton = styled.button`
  position: relative;
  overflow: hidden;
  /* thickness padding top/bottom per orbit-button-design */
  padding: 1px 0;
  border-radius: 9999px;
  cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
  transition: all 0.3s ease;
  opacity: ${props => props.disabled ? 0.5 : 1};
  
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
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 500;
  color: #e5e7eb;
  background: rgba(31, 41, 55, 0.6);
  backdrop-filter: blur(10px);
  /* inner border */
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 9999px;
  
  /* Glassy effect */
  box-shadow: 
    0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);

  /* Hover border accent to match reference graphic */
  &:hover {
    border-color: #f5b97a; /* warm peach/orange */
    background: linear-gradient(135deg, rgba(50, 50, 50, 0.9) 0%, rgba(24, 24, 24, 0.9) 100%);
    box-shadow:
      0 0 0 1px rgba(245, 185, 122, 0.6),
      0 0 12px rgba(245, 185, 122, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  }
`

const StarBottom = styled.div`
  position: absolute;
  width: 150%;
  height: 25%;
  opacity: ${props => props.$borderVariant === 'rainbow' ? 0.95 : 0.7};
  bottom: -11px;
  right: -125%;
  border-radius: 9999px;
  background: ${props =>
    props.$borderVariant === 'rainbow'
      ? 'linear-gradient(90deg, #ff5f6d 0%, #ffc371 16%, #fff36b 32%, #63ffa2 48%, #56ccf2 64%, #6c63ff 80%, #ff5fcd 100%)'
      : 'radial-gradient(circle, white, transparent 10%)'};
  background-size: ${props => props.$borderVariant === 'rainbow' ? '200% 100%' : '100% 100%'};
  animation: ${props =>
    props.$borderVariant === 'rainbow'
      ? css`${starMovementBottom} 5s linear infinite alternate, ${rainbowShift} 3s linear infinite`
      : css`${starMovementBottom} 5s linear infinite alternate`};
  z-index: 0;
  pointer-events: none;
`

const StarTop = styled.div`
  position: absolute;
  width: 150%;
  height: 25%;
  opacity: ${props => props.$borderVariant === 'rainbow' ? 0.95 : 0.7};
  top: -10px;
  left: -125%;
  border-radius: 9999px;
  background: ${props =>
    props.$borderVariant === 'rainbow'
      ? 'linear-gradient(90deg, #ff5f6d 0%, #ffc371 16%, #fff36b 32%, #63ffa2 48%, #56ccf2 64%, #6c63ff 80%, #ff5fcd 100%)'
      : 'radial-gradient(circle, white, transparent 10%)'};
  background-size: ${props => props.$borderVariant === 'rainbow' ? '200% 100%' : '100% 100%'};
  animation: ${props =>
    props.$borderVariant === 'rainbow'
      ? css`${starMovementTop} 5s linear infinite alternate, ${rainbowShift} 3s linear infinite reverse`
      : css`${starMovementTop} 5s linear infinite alternate`};
  z-index: 0;
  pointer-events: none;
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
  ...props
}) {
  const button = (
    <StyledButton
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
      style={fullWidth ? { width: '100%' } : undefined}
      {...props}
      title={disabled ? undefined : title}
    >
      <StarBottom $borderVariant={borderVariant} />
      <StarTop $borderVariant={borderVariant} />
      <ButtonContent>{children}</ButtonContent>
    </StyledButton>
  )

  if (title && disabled) {
    return (
      <span className="inline-flex max-w-full shrink-0" title={title}>
        {button}
      </span>
    )
  }

  return button
}

export default GlowingButton

