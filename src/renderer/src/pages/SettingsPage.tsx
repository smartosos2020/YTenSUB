import { useEffect, useState } from 'react'
import { api } from '../api'
import { applyTheme } from '../theme'
import { CAPTION_FONTS, captionFontCss } from '../caption-fonts'
import { Settings, Theme, TranslateSource } from '../../../shared/types'

const TRANSLATORS: { key: TranslateSource; label: string; hint: string }[] = [
  { key: 'local', label: '本地词典', hint: '离线、即时，只覆盖单词' },
  { key: 'google', label: 'Google 翻译', hint: '免费接口，支持短语和句子' },
  { key: 'llm', label: 'LLM API', hint: 'OpenAI 兼容接口，需在下方配置' }
]

function MoonIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SunIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

const THEMES: { key: Theme; label: string; icon: JSX.Element }[] = [
  { key: 'night', label: '夜晚', icon: <MoonIcon /> },
  { key: 'day', label: '白天', icon: <SunIcon /> }
]

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.settingsGet().then(setSettings)
  }, [])

  if (!settings) return <div className="page">加载中…</div>

  const toggle = (key: TranslateSource): void => {
    const enabled = settings.enabledTranslators.includes(key)
      ? settings.enabledTranslators.filter((k) => k !== key)
      : [...settings.enabledTranslators, key]
    setSettings({ ...settings, enabledTranslators: enabled })
  }

  const save = async (): Promise<void> => {
    await api.settingsSet(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="page settings-page">
      <h2>设置</h2>
      <section>
        <h3>外观</h3>
        <div className="mode-toggle">
          {THEMES.map((t) => (
            <button
              key={t.key}
              className={settings.theme === t.key ? 'icon-btn selected' : 'icon-btn'}
              title={t.label}
              onClick={() => {
                setSettings({ ...settings, theme: t.key })
                applyTheme(t.key)
              }}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>翻译方式（按 本地 → Google → LLM 顺序回退）</h3>
        {TRANSLATORS.map((t) => (
          <label key={t.key} className="translator-row">
            <input
              type="checkbox"
              checked={settings.enabledTranslators.includes(t.key)}
              onChange={() => toggle(t.key)}
            />
            <span className="translator-label">{t.label}</span>
            <span className="translator-hint">{t.hint}</span>
          </label>
        ))}
      </section>
      <section>
        <h3>字幕浮层背景透明度</h3>
        <div className="opacity-row">
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={settings.captionOpacity}
            onChange={(e) =>
              setSettings({ ...settings, captionOpacity: Number(e.target.value) })
            }
          />
          <span>{Math.round(settings.captionOpacity * 100)}%</span>
        </div>
      </section>
      <section>
        <h3>主窗字幕</h3>
        <div className="opacity-row">
          <span className="caption-size-label">字号</span>
          <input
            type="range"
            min={14}
            max={32}
            step={1}
            value={settings.captionFontSize}
            onChange={(e) =>
              setSettings({ ...settings, captionFontSize: Number(e.target.value) })
            }
          />
          <span>{settings.captionFontSize}px</span>
        </div>
        <div className="caption-font-row">
          <select
            value={settings.captionFont}
            onChange={(e) => setSettings({ ...settings, captionFont: e.target.value })}
          >
            {CAPTION_FONTS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="caption-preview">
          <div
            className="caption-preview-line"
            style={{ fontFamily: captionFontCss(settings.captionFont) || undefined }}
          >
            <div style={{ fontSize: settings.captionFontSize }}>
              The quick brown fox jumps over the lazy dog.
            </div>
            <div className="caption-preview-zh" style={{ fontSize: Math.round(settings.captionFontSize * 0.8) }}>
              主窗字幕预览文字
            </div>
          </div>
        </div>
      </section>
      <section>
        <h3>LLM API 配置</h3>
        <div className="llm-form">
          <label>
            Base URL
            <input
              value={settings.llm.baseUrl}
              onChange={(e) =>
                setSettings({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })
              }
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={settings.llm.apiKey}
              onChange={(e) =>
                setSettings({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })
              }
              placeholder="sk-..."
            />
          </label>
          <label>
            模型
            <input
              value={settings.llm.model}
              onChange={(e) =>
                setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })
              }
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>
      </section>
      <button className="save-btn" onClick={() => void save()}>
        保存
      </button>
      {saved && <span className="saved-hint">已保存</span>}
    </div>
  )
}
