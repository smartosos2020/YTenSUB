/**
 * 侧栏收缩/展开图标（源自 sidebar-toggle.svg，面板在左）。
 * mirrored=true 时水平镜像（面板在右），用于右侧面板开关。
 */
const SIDEBAR_PATH =
  'M50.01,56.074l-35.989,0c-3.309,0 -5.995,-2.686 -5.995,-5.995l0,-36.011c0,-3.308 2.686,-5.994 5.995,-5.994l35.989,0c3.309,0 5.995,2.686 5.995,5.994l0,36.011c0,3.309 -2.686,5.995 -5.995,5.995Zm-25.984,-4l0,-40l-9.012,0c-1.65,0.001 -2.989,1.34 -2.989,2.989l0,34.022c0,1.649 1.339,2.989 2.989,2.989l9.012,0Zm24.991,-40l-20.991,0l0,40l20.991,0c1.65,0 2.989,-1.34 2.989,-2.989l0,-34.022c0,-1.649 -1.339,-2.988 -2.989,-2.989Z'

export default function SidebarToggleIcon({
  mirrored = false
}: {
  mirrored?: boolean
}): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d={SIDEBAR_PATH}
        transform={mirrored ? 'translate(64 0) scale(-1 1)' : undefined}
      />
    </svg>
  )
}
