import type { ReactNode } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'

interface Props {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  className?: string
}

export default function PlayerIconButton({ label, children, onClick, disabled, loading, className }: Props): JSX.Element {
  return (
    <Tooltip label={label} position="bottom" openDelay={300} withArrow withinPortal={false} events={{ hover: true, focus: true, touch: false }}>
      <span className={`player-icon-button${className ? ` ${className}` : ''}`}>
        <ActionIcon type="button" size={32} variant="subtle" color="gray" aria-label={label} disabled={disabled} loading={loading} onClick={onClick}>
          {children}
        </ActionIcon>
      </span>
    </Tooltip>
  )
}
