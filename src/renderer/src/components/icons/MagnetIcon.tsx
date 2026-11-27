import { strokeIcon } from './strokeIcon'

export default function MagnetIcon(): JSX.Element {
  return strokeIcon(<>
    <path d="M5 3v9a7 7 0 0 0 14 0V3h-5v9a2 2 0 0 1-4 0V3Z" />
    <path d="M5 7h5m4 0h5" />
  </>)
}
