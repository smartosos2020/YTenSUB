import { strokeIcon } from './strokeIcon'

/** 下载/导出（向下箭头入托盘） */
export default function DownloadIcon(): JSX.Element {
  return strokeIcon(
    <>
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M4 21h16" />
    </>
  )
}
