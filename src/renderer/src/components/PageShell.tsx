/**
 * 模块页统一外壳（浏览页除外）：居中宽度 + 头部（标题/说明/分隔线/右侧控件）。
 * 所有模块页必须套用它——宽度、头部结构只有这一份实现，不会各页跑偏。
 */
interface Props {
  /** 标题（可带数量括号） */
  title: React.ReactNode
  /** 标题下的一行说明 */
  desc?: React.ReactNode
  /** 头部右侧控件区 */
  actions?: React.ReactNode
  /** 说明行右侧控件区（与说明文字同一行） */
  descActions?: React.ReactNode
  /** true = 外壳定高且不滚动，由子区域内部滚动（跟读页：播放条固定在底部） */
  fill?: boolean
  children: React.ReactNode
}

export default function PageShell({ title, desc, actions, descActions, fill, children }: Props): JSX.Element {
  return (
    <div className={fill ? 'page page-shell page-shell-fill' : 'page page-shell'}>
      <header className="page-head">
        <div className="page-head-row">
          <h2>{title}</h2>
          {actions && <div className="page-head-actions">{actions}</div>}
        </div>
        {(desc || descActions) && (
          <div className={descActions ? 'page-desc page-desc-row' : 'page-desc'}>
            <span>{desc}</span>
            {descActions && <span className="page-desc-actions">{descActions}</span>}
          </div>
        )}
      </header>
      {children}
    </div>
  )
}
