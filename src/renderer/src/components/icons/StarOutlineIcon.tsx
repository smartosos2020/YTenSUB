import { strokeIcon } from './strokeIcon'

/** 侧栏导航：收藏（描边星形） */
export default function StarOutlineIcon(): JSX.Element {
  return strokeIcon(
    <path d="m12 2 3.1 6.3 6.9.8-5.1 4.7 1.4 6.8-6.3-3.4-6.3 3.4 1.4-6.8L2 9.1l6.9-.8z" />
  )
}
