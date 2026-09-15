import { strokeIcon } from './strokeIcon'

/** 更多操作（三点，精选卡片反馈菜单入口用） */
export default function DotsIcon(): JSX.Element {
  return strokeIcon(
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  )
}
