import { useNavigate } from 'react-router-dom'
import { Button } from '@mantine/core'
import { FREE_DAILY_QUOTA } from '../../../shared/entitlement'
import CloseIcon from './icons/CloseIcon'

/**
 * 档位对比文案：以后改权益描述/价格只动这里。
 * 暂不出现真实价格与支付按钮（Phase C 才接支付）。
 */
const PAYWALL_PLANS: { name: string; features: string[] }[] = [
  { name: 'pro', features: ['全部精选视频', '每日更新', '自定义频道订阅', '偏好双端同步'] },
  { name: 'pro+', features: ['pro 全部权益', '精选字幕秒出'] }
]

/** 付费墙：免费精选额度用尽时弹出；当前只引导去「我的」兑换卡密 */
export default function PaywallModal({ onClose }: { onClose: () => void }): JSX.Element {
  const navigate = useNavigate()
  return (
    <div className="paywall-overlay" onClick={onClose}>
      <div className="paywall-card" onClick={(e) => e.stopPropagation()}>
        <button className="paywall-close" title="关闭" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="paywall-title">升级解锁全部精选</div>
        <div className="paywall-desc">
          免费档每天可看排序前 {FREE_DAILY_QUOTA} 部精选；升级后不限量，并解锁更多权益。
        </div>
        <div className="paywall-plans">
          {PAYWALL_PLANS.map((p) => (
            <div key={p.name} className="paywall-plan">
              <div className="paywall-plan-name">{p.name}</div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Button
          fullWidth
          onClick={() => {
            onClose()
            navigate('/profile')
          }}
        >
          去「我的」兑换卡密
        </Button>
        <div className="paywall-note">暂支持卡密兑换，在线支付即将上线</div>
      </div>
    </div>
  )
}
