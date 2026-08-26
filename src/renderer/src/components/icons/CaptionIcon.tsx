import { strokeIcon } from './strokeIcon'

/** 侧栏底部：字幕浮层开关（CC 图标） */
export default function CaptionIcon(): JSX.Element {
  return strokeIcon(
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M7 11h4" />
      <path d="M13 11h4" />
      <path d="M7 15h10" />
    </>
  )
}
