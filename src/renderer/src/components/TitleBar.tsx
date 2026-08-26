import { useEffect, useState } from 'react'
import { api } from '../api'
// 图标复制自 resources/icon.png（vite 构建无法引用 renderer 根目录外的文件）
import iconUrl from '../assets/icon.png'
import SidebarToggleIcon from './SidebarToggleIcon'
import CaptionIcon from './icons/CaptionIcon'
import MinimizeIcon from './icons/MinimizeIcon'
import MaximizeIcon from './icons/MaximizeIcon'
import RestoreIcon from './icons/RestoreIcon'
import CloseIcon from './icons/CloseIcon'

interface Props {
  collapsed: boolean
  onToggle: () => void
  /** 字幕浮层总开关 */
  showCaptions: boolean
  onToggleCaptions: () => void
}

/**
 * 自定义标题栏（主进程 frame: false）：应用图标 + 名称 + 左菜单开关 +
 * 最小化 / 最大化-还原 / 关闭按钮。整条为拖拽区域，按钮 no-drag。
 */
export default function TitleBar({
  collapsed,
  onToggle,
  showCaptions,
  onToggleCaptions
}: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => api.onWindowMaximizeChanged(setMaximized), [])

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
      <button
        className={showCaptions ? 'titlebar-toggle on' : 'titlebar-toggle'}
        title={showCaptions ? '关闭字幕' : '开启字幕'}
        onClick={onToggleCaptions}
      >
        <CaptionIcon />
      </button>
      <div className="titlebar-controls">
        <button title="最小化" onClick={() => api.windowMinimize()}>
          <MinimizeIcon />
        </button>
        <button
          title={maximized ? '还原' : '最大化'}
          onClick={() => api.windowToggleMaximize()}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="titlebar-close" title="关闭" onClick={() => api.windowClose()}>
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}
