import { strokeIcon } from './strokeIcon'

/** 搜索（放大镜） */
export default function SearchIcon(): JSX.Element {
  return strokeIcon(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  )
}
