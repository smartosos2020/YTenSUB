import { useEffect, useState } from 'react'
import { api } from '../api'
import { applyTheme, ACCENTS } from '../theme'
import { CAPTION_FONTS, captionFontCss } from '../caption-fonts'
import { captionTextureStyle } from '../caption-style'
import { CaptionTexture, DEFAULT_SETTINGS, Settings, Theme, TranslateResult, TranslateSource } from '../../../shared/types'
import MoonIcon from '../components/icons/MoonIcon'
import SunIcon from '../components/icons/SunIcon'
import AutoIcon from '../components/icons/AutoIcon'
import EyeIcon from '../components/icons/EyeIcon'
import EyeOffIcon from '../components/icons/EyeOffIcon'
import VolumeIcon from '../components/icons/VolumeIcon'
import BookIcon from '../components/icons/BookIcon'

const TRANSLATORS: { key: TranslateSource; label: string; hint: string }[] = [
  { key: 'local', label: '本地离线词典', hint: '内置常用词库，毫秒级即时查词' },
  { key: 'google', label: 'Google 翻译', hint: '免费云端接口，覆盖短语与完整长句' },
  { key: 'llm', label: 'LLM 大模型 API', hint: 'OpenAI 兼容接口，语境理解与口语化翻译' }
]

/** LLM 服务商预设：选中即填入 baseUrl/model；Ollama 不校验 key，占位即可 */
const LLM_PRESETS: { key: string; label: string; baseUrl: string; model: string; hint: string }[] = [
  {
    key: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    hint: '本地运行，无需真实 API Key；模型名按本机已拉取的填写'
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: 'platform.deepseek.com 充值按量计费，成本极低'
  },
  {
    key: 'gemini',
    label: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
    hint: 'Google AI Studio 免费申请 API Key'
  }
]

const THEMES: { key: Theme; label: string; desc: string; icon: JSX.Element }[] = [
  { key: 'night', label: '夜晚', desc: '深色护眼，适合夜间观影', icon: <MoonIcon /> },
  { key: 'day', label: '白天', desc: '明亮通透，适合白天使用', icon: <SunIcon /> },
  { key: 'system', label: '跟随系统', desc: '随系统外观自动切换', icon: <AutoIcon /> }
]

const TEXTURES: { key: CaptionTexture; label: string }[] = [
  { key: 'solid', label: '纯色（默认）' },
  { key: 'glass', label: '毛玻璃' },
  { key: 'none', label: '无边框纯文字' }
]

type SettingsTab = 'all' | 'appearance' | 'caption' | 'translate' | 'llm' | 'data'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'appearance', label: '外观' },
  { key: 'caption', label: '字幕排版' },
  { key: 'translate', label: '翻译管道' },
  { key: 'llm', label: 'LLM 模型' },
  { key: 'data', label: '数据维护' }
]

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<SettingsTab>('all')
  const [saveFlash, setSaveFlash] = useState(false)
  const [dataMsg, setDataMsg] = useState('')
  const [vocabCount, setVocabCount] = useState<number | null>(null)
  const [favCount, setFavCount] = useState<number | null>(null)
  // 管道测试器
  const [pipeText, setPipeText] = useState('')
  const [pipeTesting, setPipeTesting] = useState(false)
  const [pipeResult, setPipeResult] = useState<{
    translation: string
    source: string
    ms: number
  } | null>(null)
  // LLM 连通性测试
  const [llmTestState, setLlmTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [llmMs, setLlmMs] = useState(0)
  const [showKey, setShowKey] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    api.settingsGet().then(setSettings)
    api.vocabList().then((l: unknown[]) => setVocabCount(l.length)).catch(() => {})
    api.favList().then((l: unknown[]) => setFavCount(l.length)).catch(() => {})
  }, [])

  if (!settings) return <div className="page">加载中…</div>

  /** 实时保存：任何修改立即写盘并广播（浏览页等即时生效） */
  const update = (next: Settings): void => {
    setSettings(next)
    void api.settingsSet(next).then(() => {
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 1200)
    })
  }

  const toggle = (key: TranslateSource): void => {
    const enabled = settings.enabledTranslators.includes(key)
      ? settings.enabledTranslators.filter((k) => k !== key)
      : [...settings.enabledTranslators, key]
    update({ ...settings, enabledTranslators: enabled })
  }

  const applyPreset = (key: string): void => {
    const p = LLM_PRESETS.find((x) => x.key === key)
    if (!p) return
    update({
      ...settings,
      llm: {
        baseUrl: p.baseUrl,
        model: p.model,
        apiKey: p.key === 'ollama' ? settings.llm.apiKey || 'ollama' : settings.llm.apiKey
      }
    })
  }

  const flashDataMsg = (msg: string): void => {
    setDataMsg(msg)
    setTimeout(() => setDataMsg(''), 2000)
  }

  const exportData = async (): Promise<void> => {
    const r = await api.dataExport()
    if (typeof r === 'string') flashDataMsg('已导出')
  }

  /** 导入成功后数据已整体替换，重载渲染进程让所有页面读新数据 */
  const importData = async (): Promise<void> => {
    const r = await api.dataImport()
    if (r === 'ok') window.location.reload()
    else if (r === 'invalid') flashDataMsg('文件无效')
  }

  const activePreset =
    LLM_PRESETS.find((p) => p.baseUrl === settings.llm.baseUrl)?.key ?? 'custom'
  const show = (key: Exclude<SettingsTab, 'all'>): boolean => tab === 'all' || tab === key

  /** 管道测试器：走完整翻译链，显示命中引擎与耗时 */
  const testPipe = async (): Promise<void> => {
    const t = pipeText.trim()
    if (!t || pipeTesting) return
    setPipeTesting(true)
    setPipeResult(null)
    const t0 = Date.now()
    const r = (await api.translate(t)) as TranslateResult | null
    const ms = Date.now() - t0
    const SRC: Record<string, string> = { local: '本地离线词典', google: 'Google 翻译', llm: 'LLM 大模型' }
    setPipeResult(r ? { translation: r.translation, source: SRC[r.source] ?? r.source, ms } : null)
    setPipeTesting(false)
  }

  const runLlmTest = async (): Promise<void> => {
    setLlmTestState('testing')
    const r = (await api.llmTest()) as { ok: boolean; ms: number }
    setLlmMs(r.ms)
    setLlmTestState(r.ok ? 'ok' : 'fail')
  }

  return (
    <div className="page settings-page">
      <div className="settings-center">
        <header className="settings-head">
        <div>
          <h2>
            偏好设置 <span className="settings-title-en">(Preferences)</span>
          </h2>
          <div className="settings-sub">配置外观主题、字幕排版、翻译管道与本地 LLM 大模型推理服务</div>
        </div>
        <div className="settings-head-right">
          <span className={saveFlash ? 'save-badge flash' : 'save-badge'}>
            {saveFlash ? '✓ 已保存' : '实时保存生效'}
          </span>
          <div className="seg-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'selected' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="settings-body">
          {show('appearance') && (
            <div className="settings-group">
              <div className="group-head">
                <span className="group-title">外观与通用偏好</span>
                <span className="card-note">主题即时生效</span>
              </div>
              <section className="settings-card">
              <div className="field-label">界面主题（Appearance Theme）</div>
              <div className="theme-cards">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    className={settings.theme === t.key ? 'theme-card selected' : 'theme-card'}
                    onClick={() => {
                      applyTheme(t.key, settings.accentColor)
                      update({ ...settings, theme: t.key })
                    }}
                  >
                    {settings.theme === t.key && <span className="theme-check">✓</span>}
                    <span className="theme-card-icon">{t.icon}</span>
                    <span className="theme-card-name">{t.label}</span>
                    <span className="theme-card-desc">{t.desc}</span>
                  </button>
                ))}
              </div>
              <div className="card-divider" />
              <div className="field-label">主题强调色（Accent Color）</div>
              <div className="accent-row">
                <span className="engine-info">
                  <span className="engine-name">主题强调色</span>
                  <span className="engine-hint">影响高亮重点、生词标记与状态提示的主色调</span>
                </span>
                <span className="accent-dots">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.key}
                      className={settings.accentColor === a.key ? 'accent-dot selected' : 'accent-dot'}
                      style={{ background: a.dot, color: a.dot }}
                      title={a.label}
                      onClick={() => {
                        applyTheme(settings.theme, a.key)
                        update({ ...settings, accentColor: a.key })
                      }}
                    />
                  ))}
                </span>
              </div>
              <div className="card-divider" />
              <div className="field-label">取词行为</div>
              <label className="behavior-row">
                <span className="behavior-icon">
                  <VolumeIcon />
                </span>
                <span className="engine-info">
                  <span className="engine-name">查词后自动朗读发音</span>
                  <span className="engine-hint">翻译弹窗打开即播放单词发音</span>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={settings.autoSpeakOnLookup}
                    onChange={(e) => update({ ...settings, autoSpeakOnLookup: e.target.checked })}
                  />
                  <span className="switch-slider" />
                </span>
              </label>
              <label className="behavior-row">
                <span className="behavior-icon">
                  <BookIcon />
                </span>
                <span className="engine-info">
                  <span className="engine-name">查词后自动加入生词本</span>
                  <span className="engine-hint">翻译成功即收藏，无需再点按钮</span>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={settings.autoCollectWord}
                    onChange={(e) => update({ ...settings, autoCollectWord: e.target.checked })}
                  />
                  <span className="switch-slider" />
                </span>
              </label>
              </section>
            </div>
          )}

          {show('translate') && (
            <div className="settings-group">
              <div className="group-head">
                <span className="group-title">翻译管道与回退策略</span>
                <span className="card-note">按序号自上而下逐级回退</span>
              </div>
              <section className="settings-card">
              <div className="pipe">
                <span className="pipe-chip">
                  <b>1</b> 本地离线词典
                </span>
                <span className="pipe-arrow">→</span>
                <span className="pipe-chip">
                  <b>2</b> Google 翻译
                </span>
                <span className="pipe-arrow">→</span>
                <span className="pipe-chip">
                  <b>3</b> LLM 大模型 API
                </span>
              </div>
              {TRANSLATORS.map((t, i) => (
                <label
                  key={t.key}
                  className={
                    settings.enabledTranslators.includes(t.key) ? 'engine-row' : 'engine-row off'
                  }
                >
                  <span className="engine-num">{i + 1}</span>
                  <span className="engine-info">
                    <span className="engine-name">{t.label}</span>
                    <span className="engine-hint">{t.hint}</span>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={settings.enabledTranslators.includes(t.key)}
                      onChange={() => toggle(t.key)}
                    />
                    <span className="switch-slider" />
                  </span>
                </label>
              ))}
              <div className="card-divider" />
              <div className="field-label">管道测试（Pipeline Debugger）</div>
              <div className="pipe-test">
                <input
                  value={pipeText}
                  onChange={(e) => setPipeText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void testPipe()}
                  placeholder="输入单词或句子，回车测试"
                />
                <button disabled={pipeTesting} onClick={() => void testPipe()}>
                  {pipeTesting ? '测试中…' : '测试'}
                </button>
              </div>
              {pipeResult && (
                <div className="pipe-result">
                  <div className="pipe-result-meta">
                    命中引擎：{pipeResult.source} · {pipeResult.ms}ms
                  </div>
                  <div className="pipe-result-text">{pipeResult.translation}</div>
                </div>
              )}
              </section>
            </div>
          )}

          {show('caption') && (
            <div className="settings-group">
              <div className="group-head">
                <span className="group-title">字幕排版</span>
                <span className="card-note">即时同步至右侧舞台</span>
              </div>
              <section className="settings-card">
              <div className="field-2col">
                <div>
                  <div className="field-label">原文主字号（{settings.captionFontSize}px）</div>
                  <div className="opacity-row">
                    <input
                      type="range"
                      min={14}
                      max={32}
                      step={1}
                      value={settings.captionFontSize}
                      onChange={(e) =>
                        update({ ...settings, captionFontSize: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div>
                  <div className="field-label">
                    浮层背景透明度（{Math.round(settings.captionOpacity * 100)}%）
                  </div>
                  <div className="opacity-row">
                    <input
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={settings.captionOpacity}
                      onChange={(e) =>
                        update({ ...settings, captionOpacity: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="card-divider" />
              <div className="field-label">字体族（Font Family）</div>
              <select
                value={settings.captionFont}
                onChange={(e) => update({ ...settings, captionFont: e.target.value })}
              >
                {CAPTION_FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <div className="card-divider" />
              <div className="field-label">浮层边框质感（Container Texture）</div>
              <select
                value={settings.captionTexture}
                onChange={(e) =>
                  update({ ...settings, captionTexture: e.target.value as CaptionTexture })
                }
              >
                {TEXTURES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              </section>
            </div>
          )}

          {show('llm') && (
            <div className="settings-group">
              <div className="group-head">
                <span className="group-title">大模型配置（LLM API）</span>
                <span className="card-note">支持 OpenAI 兼容协议</span>
              </div>
              <section className="settings-card">
              <div className="field-label">服务商预设（Provider Preset）</div>
              <div className="preset-grid">
                {LLM_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={activePreset === p.key ? 'preset-card active' : 'preset-card'}
                    onClick={() => applyPreset(p.key)}
                  >
                    <span className="preset-name">{p.label}</span>
                    <span className="preset-model">{p.model}</span>
                    {activePreset === p.key && <span className="preset-check">✓</span>}
                  </button>
                ))}
                <button
                  className={activePreset === 'custom' ? 'preset-card active' : 'preset-card'}
                  onClick={() => {}}
                  title="手动填写下方字段"
                >
                  <span className="preset-name">自定义</span>
                  <span className="preset-model">custom model</span>
                  {activePreset === 'custom' && <span className="preset-check">✓</span>}
                </button>
              </div>
              {activePreset !== 'custom' && (
                <div className="preset-hint">{LLM_PRESETS.find((p) => p.key === activePreset)?.hint}</div>
              )}
              <div className="card-divider" />
              <div className="field-2col">
                <label className="llm-field">
                  <span className="field-label">接口 Base URL</span>
                  <input
                    value={settings.llm.baseUrl}
                    onChange={(e) =>
                      update({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="llm-field">
                  <span className="field-label">模型名称（Model）</span>
                  <input
                    value={settings.llm.model}
                    onChange={(e) =>
                      update({ ...settings, llm: { ...settings.llm, model: e.target.value } })
                    }
                    placeholder="gpt-4o-mini"
                  />
                </label>
              </div>
              <label className="llm-field">
                <span className="field-label">API 授权密钥（API Key）</span>
                <span className="key-row">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.llm.apiKey}
                    onChange={(e) =>
                      update({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })
                    }
                    placeholder="sk-..."
                  />
                  <button
                    className="key-eye"
                    title={showKey ? '隐藏' : '显示'}
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </span>
              </label>
              <div className="card-divider" />
              <div className="llm-test-row">
                <button disabled={llmTestState === 'testing'} onClick={() => void runLlmTest()}>
                  {llmTestState === 'testing' ? '测试中…' : '测试接口连通性'}
                </button>
                {llmTestState === 'ok' && (
                  <span className="llm-test-ok">连接正常 · {llmMs}ms</span>
                )}
                {llmTestState === 'fail' && (
                  <span className="llm-test-fail">连接失败，请检查配置与网络</span>
                )}
              </div>
              </section>
            </div>
          )}

          {show('data') && (
            <div className="settings-group">
              <div className="group-head">
                <span className="group-title">数据维护与同步</span>
                <span className="card-note">支持 JSON 备份与 CSV 生词导出</span>
              </div>
              <section className="settings-card">
              <div className="stat-grid">
                <div className="stat-tile">
                  <div className="stat-num">{vocabCount ?? '-'}</div>
                  <div className="stat-label">生词积累（词）</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-num">{favCount ?? '-'}</div>
                  <div className="stat-label">精读收藏（部）</div>
                </div>
              </div>
              <div className="card-divider" />
              <div className="data-row">
                <button onClick={() => void exportData()}>导出数据（JSON）</button>
                <button title="从备份文件恢复（导入后自动重载）" onClick={() => void importData()}>
                  导入数据
                </button>
                {dataMsg && <span className="saved-hint">{dataMsg}</span>}
              </div>
              {/* 危险操作：原地两段确认，不弹系统对话框 */}
              <div className="data-row danger-zone">
                {!confirmReset ? (
                  <button className="reset-btn" onClick={() => setConfirmReset(true)}>
                    恢复默认设置
                  </button>
                ) : (
                  <span className="reset-confirm">
                    确定恢复默认设置？（生词/收藏不受影响）
                    <button
                      className="reset-yes"
                      onClick={() => {
                        void api.settingsSet(DEFAULT_SETTINGS).then(() => window.location.reload())
                      }}
                    >
                      确认重置
                    </button>
                    <button onClick={() => setConfirmReset(false)}>取消</button>
                  </span>
                )}
              </div>
              <div className="card-footnote">生词 CSV 导出在生词本页面工具条</div>
              </section>
            </div>
          )}
        {/* 右侧实时预览舞台：字幕设置即时渲染；固定在第 1 行与首个分区卡片对齐 */}
        <aside className="settings-stage">
          <div className="group-head">
            <span className="group-title">字幕预览舞台</span>
            <span className="card-note">LIVE PREVIEW</span>
          </div>
          <div className="stage-card">
            <div className="stage-screen">
              <div
                className="caption-preview-line"
                style={{
                  fontFamily: captionFontCss(settings.captionFont) || undefined,
                  ...captionTextureStyle(settings.captionTexture, settings.captionOpacity)
                }}
              >
                <div style={{ fontSize: settings.captionFontSize }}>
                  The quick brown fox <span className="stage-word">jumps</span> over the lazy dog.
                </div>
                <div
                  className="caption-preview-zh"
                  style={{ fontSize: Math.round(settings.captionFontSize * 0.8) }}
                >
                  敏捷的棕色狐狸跳过了那只懒狗。
                </div>
              </div>
              <div className="stage-popup">
                <span className="stage-popup-word">jumps</span>
                <span className="stage-popup-zh">跳跃（三单）</span>
              </div>
            </div>
            <div className="stage-meta">
              字号 {settings.captionFontSize}px · 透明度 {Math.round(settings.captionOpacity * 100)}%
            </div>
          </div>
        </aside>
      </div>
      </div>
    </div>
  )
}
