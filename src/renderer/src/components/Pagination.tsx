interface Props {
  /** 当前页（0 基） */
  page: number
  pageCount: number
  onChange: (page: number) => void
}

/** 页码序列：≤7 页全显；否则首尾 + 当前页窗口，间隙用 … */
function pageSeq(count: number, c: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i)
  const set = new Set([0, 1, c - 1, c, c + 1, count - 2, count - 1].filter((i) => i >= 0 && i < count))
  const arr = [...set].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] - arr[i - 1] > 1) out.push('…')
    out.push(arr[i])
  }
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
