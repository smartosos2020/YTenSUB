import { strokeIcon } from './strokeIcon'

/** 锁定态（付费墙/免费额度外用） */
export default function LockIcon(): JSX.Element {
  return strokeIcon(
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  )
}
