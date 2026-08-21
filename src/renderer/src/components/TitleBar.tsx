// 图标复制自 resources/icon.png（vite 构建无法引用 renderer 根目录外的文件）
import iconUrl from '../assets/icon.png'
import SidebarToggleIcon from './SidebarToggleIcon'

interface Props {
  collapsed: boolean
  onToggle: () => void
}

/**
 * 自定义标题栏（主进程 titleBarStyle: 'hidden'）：应用图标 + 名称 + 左菜单开关。
 * 右上角的最小化/最大化/关闭由原生 titleBarOverlay 绘制；整条为拖拽区域。
 */
export default function TitleBar({ collapsed, onToggle }: Props): JSX.Element {
  return (
    <header className="titlebar">
      <img className="titlebar-icon" src={iconUrl} alt="" draggable={false} />
      <span className="titlebar-title">YTenSUB</span>
      <button
        className="titlebar-toggle"
        title={collapsed ? '展开菜单' : '收起菜单'}
        onClick={onToggle}
      >
        <SidebarToggleIcon />
      </button>
    </header>
  )
}
