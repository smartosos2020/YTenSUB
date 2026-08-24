import { strokeIcon } from './strokeIcon'

/** 显示密码（眼睛） */
export default function EyeIcon(): JSX.Element {
  return strokeIcon(
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  )
}
