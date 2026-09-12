interface Props {
  /** 当前页（0 基） */
  page: number
  pageCount: number
  onChange: (page: number) => void
}

/** 页码序列：≤5 页全显；否则"当前页窗口 3 个 + … + 末页"（窗口紧邻末页时直接连上，不显示 …） */
function pageSeq(count: number, c: number): (number | '…')[] {
  if (count <= 5) return Array.from({ length: count }, (_, i) => i)
  const start = Math.min(Math.max(c - 1, 0), count - 3)
  const window3 = [start, start + 1, start + 2]
  const out: (number | '…')[] = [...window3]
  if (window3[2] === count - 2) out.push(count - 1) // 窗口紧邻末页：直接连上
  else if (window3[2] < count - 2) out.push('…', count - 1)
  return out
}

/** 分页控件：« ‹ 1 2 3 … N › »，当前页高亮（pageCount ≤ 1 时不渲染） */
export default function Pagination({ page, pageCount, onChange }: Props): JSX.Element | null {
  if (pageCount <= 1) return null
  const cur = Math.min(page, pageCount - 1)
  return (
    <span className="pagination">
      <button className="icon-btn" disabled={cur === 0} title="第一页" onClick={() => onChange(0)}>
        «
      </button>
      <button className="icon-btn" disabled={cur === 0} title="上一页" onClick={() => onChange(cur - 1)}>
        ‹
      </button>
      {pageSeq(pageCount, cur).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="pagination-ellipsis">
            …
          </span>
        ) : (
          <button
            key={p}
            className={p === cur ? 'pagination-num selected' : 'pagination-num'}
            onClick={() => onChange(p)}
          >
            {p + 1}
          </button>
        )
      )}
      <button
        className="icon-btn"
        disabled={cur >= pageCount - 1}
        title="下一页"
        onClick={() => onChange(cur + 1)}
      >
        ›
      </button>
      <button
        className="icon-btn"
        disabled={cur >= pageCount - 1}
        title="最后一页"
        onClick={() => onChange(pageCount - 1)}
      >
        »
      </button>
    </span>
  )
}
