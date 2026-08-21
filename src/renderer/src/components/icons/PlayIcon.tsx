import { strokeIcon } from './strokeIcon'

/** 侧栏导航：浏览（播放圆钮） */
export default function PlayIcon(): JSX.Element {
  return strokeIcon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 6 4-6 4z" />
    </>
  )
}
