import { strokeIcon } from './strokeIcon'

/** 侧栏导航：我的（人形） */
export default function UserIcon(): JSX.Element {
  return strokeIcon(
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  )
}
