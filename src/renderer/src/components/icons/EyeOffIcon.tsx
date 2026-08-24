import { strokeIcon } from './strokeIcon'

/** 隐藏密码（眼睛划线） */
export default function EyeOffIcon(): JSX.Element {
  return strokeIcon(
    <>
      <path d="M17.94 17.94A10.6 10.6 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06" />
      <path d="M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a21.7 21.7 0 0 1-3.22 4.31" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="m3 3 18 18" />
    </>
  )
}
