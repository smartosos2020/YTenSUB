import { strokeIcon } from './strokeIcon'

/** 侧栏导航：本地视频文件 */
export default function LocalVideoIcon(): JSX.Element {
  return strokeIcon(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 9 5 3-5 3zM3 9h2M3 15h2M19 9h2M19 15h2" />
    </>
  )
}
