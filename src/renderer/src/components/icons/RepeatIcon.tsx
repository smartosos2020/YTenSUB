import { strokeIcon } from './strokeIcon'

/** 侧栏导航：复习（循环箭头） */
export default function RepeatIcon(): JSX.Element {
  return strokeIcon(
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  )
}
