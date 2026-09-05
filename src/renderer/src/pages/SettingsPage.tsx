import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Button,
  PasswordInput,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  TextInput
} from '@mantine/core'
import { api } from '../api'
import { applyTheme, ACCENTS } from '../theme'
import { CAPTION_FONTS, captionFontCss } from '../caption-fonts'
import { Cue } from '../../../shared/captions'
import { CaptionTexture, DEFAULT_SETTINGS, MASTERED_LEVEL, Settings, ShadowingStrategy, Theme, TranslateResult, TranslateSource, VocabItem } from '../../../shared/types'
import { toKnownLemmas, findSavedByLemma } from '../lemma'
import CaptionOverlay from '../components/CaptionOverlay'
import TranslatePopup from '../components/TranslatePopup'
import { WordSelection } from '../components/SubtitlePanel'
import MoonIcon from '../components/icons/MoonIcon'
import SunIcon from '../components/icons/SunIcon'
import AutoIcon from '../components/icons/AutoIcon'
import VolumeIcon from '../components/icons/VolumeIcon'
import BookIcon from '../components/icons/BookIcon'
import SearchIcon from '../components/icons/SearchIcon'
import PageShell from '../components/PageShell'

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

type SettingsTab = 'all' | 'appearance' | 'caption' | 'translate' | 'llm' | 'data'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'appearance', label: '外观' },
  { key: 'caption', label: '字幕排版' },
  { key: 'translate', label: '翻译管道' },
  { key: 'llm', label: 'LLM 模型' },
  { key: 'data', label: '数据维护' }
]

const WEIGHTS = [
  { value: '400', label: '常规' },
  { value: '500', label: '适中' },
  { value: '700', label: '加粗' },
  { value: '800', label: '特粗' }
]

/** 预览舞台的样本字幕：文本固定，组件与事件全是真实字幕浮层 */
const SAMPLE_CUES: Cue[] = [
  { start: 0, dur: 600, text: 'The quick brown fox jumps over the lazy dog.' }
]
const SAMPLE_ZH = ['敏捷的棕色狐狸跳过了那只懒狗。']
const noop = (): void => {}

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<SettingsTab>('all')
  const [saveFlash, setSaveFlash] = useState(false)
  const [dataMsg, setDataMsg] = useState('')
  const [vocabList, setVocabList] = useState<VocabItem[] | null>(null)
  const [favCount, setFavCount] = useState<number | null>(null)
  const [captionCacheCount, setCaptionCacheCount] = useState<number | null>(null)
  // 学习统计（按日）：今日复习次数/认识率
  const [stats, setStats] = useState<Record<string, { reviewed: number; known: number }>>({})
  // 手机同步服务地址（开启后显示，如 http://192.168.0.10:47832）
  const [syncAddr, setSyncAddr] = useState('')

  /** 开启局域网同步服务，失败提示 */
  const startSync = async (): Promise<void> => {
    const r = await api.syncStart()
    if (r) setSyncAddr(`http://${r.ip}:${r.port}`)
    else setDataMsg('同步服务启动失败（端口被占用或无局域网）')
  }
  // 预览舞台取词弹窗
  const [selection, setSelection] = useState<WordSelection | null>(null)
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
  const [confirmReset, setConfirmReset] = useState(false)
  // 自定义预设可被点选：override 优先于由 baseUrl 推导的结果
  const [presetOverride, setPresetOverride] = useState<string | null>(null)

  useEffect(() => {
    api.settingsGet().then(setSettings)
    api.vocabList().then((l: VocabItem[]) => setVocabList(l)).catch(() => {})
    api.favList().then((l: unknown[]) => setFavCount(l.length)).catch(() => {})
    api.captionsCacheSize().then(setCaptionCacheCount).catch(() => {})
    api.statsGet().then(setStats).catch(() => {})
  }, [])

  if (!settings) return <div className="page">加载中…</div>

  const vocabCount = vocabList?.length ?? null
  // 预览舞台的生词高亮与真实字幕一致：满级"已掌握"的词不再高亮
  const knownWords = toKnownLemmas(vocabList ?? [])
  // 统计卡：已掌握数（满级）+ 今日复习/认识率
  const masteredCount = vocabList
    ? vocabList.filter((v) => (v.reviewLevel ?? 0) >= MASTERED_LEVEL).length
    : null
  const todayKey = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const today = stats[todayKey] ?? { reviewed: 0, known: 0 }
  const todayStats = {
    reviewed: today.reviewed,
    rate: today.reviewed > 0 ? `${Math.round((today.known / today.reviewed) * 100)}%` : '-'
  }

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
    setPresetOverride(null) // 选了真实预设：交还给 baseUrl 推导
    // 用户手动改过的模型名不被预设覆盖：仅当模型为空、或仍是某预设默认值时才替换
    const isPresetModel = LLM_PRESETS.some((x) => x.model === settings.llm.model)
    const model = settings.llm.model && !isPresetModel ? settings.llm.model : p.model
    update({
      ...settings,
      llm: {
        baseUrl: p.baseUrl,
        model,
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

  const activePresetDerived =
    LLM_PRESETS.find((p) => p.baseUrl === settings.llm.baseUrl)?.key ?? 'custom'
  const activePreset = presetOverride ?? activePresetDerived
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
    <PageShell
      title="偏好设置"
      desc="配置外观主题、字幕排版、翻译管道与本地 LLM 大模型推理服务"
      actions={
        <>
          <span className={saveFlash ? 'save-badge flash' : 'save-badge'}>
            {saveFlash ? '✓ 已保存' : '实时保存生效'}
          </span>
          <SegmentedControl
            value={tab}
            onChange={(v) => setTab(v as SettingsTab)}
            data={TABS.map((t) => ({ value: t.key, label: t.label }))}
          />
        </>
      }
    >
      <div className="settings-body">
          {show('appearance') && (
            <div className="settings-group">
              <div className="group-head">
                <span className="group-title">外观与通用偏好</span>
                <span className="card-note">主题即时生效</span>
              </div>
              <section className="settings-card">
              <div className="field-label">界面主题</div>
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
              <div className="behavior-row">
                <span className="behavior-icon">
                  <VolumeIcon />
                </span>
                <span className="engine-info">
                  <span className="engine-name">查词后自动朗读发音</span>
                  <span className="engine-hint">翻译弹窗打开即播放单词发音</span>
                </span>
                <Switch
                  checked={settings.autoSpeakOnLookup}
                  onChange={(e) => update({ ...settings, autoSpeakOnLookup: e.currentTarget.checked })}
                />
              </div>
              <div className="behavior-row">
                <span className="behavior-icon">
                  <BookIcon />
                </span>
                <span className="engine-info">
                  <span className="engine-name">查词后自动加入生词本</span>
                  <span className="engine-hint">翻译成功即收藏，无需再点按钮</span>
                </span>
                <Switch
                  checked={settings.autoCollectWord}
                  onChange={(e) => update({ ...settings, autoCollectWord: e.currentTarget.checked })}
                />
              </div>
              <div className="behavior-row">
                <span className="behavior-icon">
                  <SearchIcon />
                </span>
                <span className="engine-info">
                  <span className="engine-name">悬停取词</span>
                  <span className="engine-hint">鼠标悬停字幕单词 300ms 自动弹出翻译，扫过不触发</span>
                </span>
                <Switch
                  checked={settings.hoverTranslate}
                  onChange={(e) => update({ ...settings, hoverTranslate: e.currentTarget.checked })}
                />
              </div>
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
              {(() => {
                const enabledOrder = settings.enabledTranslators.filter((t) =>
                  TRANSLATORS.some((x) => x.key === t)
                )
                const disabledList = TRANSLATORS.map((t) => t.key).filter(
                  (k) => !enabledOrder.includes(k)
                )
                const moveEngine = (key: TranslateSource, dir: -1 | 1): void => {
                  const arr = [...enabledOrder]
                  const i = arr.indexOf(key)
                  const j = i + dir
                  if (i < 0 || j < 0 || j >= arr.length) return
                  ;[arr[i], arr[j]] = [arr[j], arr[i]]
                  update({ ...settings, enabledTranslators: arr })
                }
                return [...enabledOrder, ...disabledList].map((key) => {
                  const t = TRANSLATORS.find((x) => x.key === key)!
                  const idx = enabledOrder.indexOf(key)
                  const enabled = idx >= 0
                  return (
                    <div key={key} className={enabled ? 'engine-row' : 'engine-row off'}>
                      <span className="engine-num">{enabled ? idx + 1 : '–'}</span>
                      <span className="engine-info">
                        <span className="engine-name">{t.label}</span>
                        <span className="engine-hint">{t.hint}</span>
                      </span>
                      {enabled && (
                        <span className="engine-arrows">
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            title="上移"
                            disabled={idx === 0}
                            onClick={() => moveEngine(key, -1)}
                          >
                            ↑
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            title="下移"
                            disabled={idx === enabledOrder.length - 1}
                            onClick={() => moveEngine(key, 1)}
                          >
                            ↓
                          </ActionIcon>
                        </span>
                      )}
                      <Switch checked={enabled} onChange={() => toggle(key)} />
                    </div>
                  )
                })
              })()}
              <div className="card-divider" />
              <div className="field-label">管道测试</div>
              <div className="pipe-test">
                <TextInput
                  value={pipeText}
                  onChange={(e) => setPipeText(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void testPipe()}
                  placeholder="输入单词或句子，回车测试"
                  style={{ flex: 1 }}
                />
                <Button variant="light" loading={pipeTesting} onClick={() => void testPipe()}>
                  测试
                </Button>
              </div>
              {pipeResult && (
                <div className="pipe-result">
                  <div className="pipe-result-meta">
                    命中引擎：{pipeResult.source} · {pipeResult.ms}ms
                  </div>
                  <div className="pipe-result-text">{pipeResult.translation}</div>
                </div>
              )}
              <div className="card-divider" />
              <div className="field-label">跟读脚本生成策略</div>
              <Select
                value={settings.shadowingStrategy}
                onChange={(v) =>
                  v && update({ ...settings, shadowingStrategy: v as ShadowingStrategy })
                }
                data={[
                  { value: 'llm-fallback', label: 'LLM 优先，本地规则兜底（推荐）' },
                  { value: 'llm-only', label: '仅 LLM（质量最佳，需配置 API）' },
                  { value: 'rules-only', label: '仅本地规则（免费离线，质量较低）' },
                  { value: 'raw', label: '直接使用字幕（不提炼，保留完整语境）' }
                ]}
                allowDeselect={false}
              />
              <div className="card-divider" />
              <div className="behavior-row">
                <span className="engine-info">
                  <span className="engine-name">收藏难度用 LLM 精估</span>
                  <span className="engine-hint">
                    关闭时用离线词频估算（免费即时）；开启后收藏视频时自动调用 LLM 定级（花 token 更准）
                  </span>
                </span>
                <Switch
                  checked={settings.levelEstimator === 'llm'}
                  onChange={(e) =>
                    update({ ...settings, levelEstimator: e.currentTarget.checked ? 'llm' : 'freq' })
                  }
                />
              </div>
              <div className="behavior-row">
                <span className="engine-info">
                  <span className="engine-name">收藏时自动打内容标签</span>
                  <span className="engine-hint">
                    先按 YouTube 官方分类自动映射（免费）；映射不上且 LLM 已配置时由 LLM 判断，手动改过的标签不覆盖
                  </span>
                </span>
                <Switch
                  checked={settings.autoTag}
                  onChange={(e) => update({ ...settings, autoTag: e.currentTarget.checked })}
                />
              </div>
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
                  <div className="field-label">原文字号（{settings.captionFontSize}px）</div>
                  <Slider
                    min={14}
                    max={32}
                    step={1}
                    value={settings.captionFontSize}
                    onChange={(v) => update({ ...settings, captionFontSize: v })}
                    label={(v) => `${v}px`}
                  />
                </div>
                <div>
                  <div className="field-label">中文字号（{settings.captionZhSize}px）</div>
                  <Slider
                    min={12}
                    max={28}
                    step={1}
                    value={settings.captionZhSize}
                    onChange={(v) => update({ ...settings, captionZhSize: v })}
                    label={(v) => `${v}px`}
                  />
                </div>
              </div>
              <div className="field-2col">
                <div>
                  <div className="field-label">英文字幕字重</div>
                  <SegmentedControl
                    value={String(settings.captionWeight)}
                    onChange={(v) => update({ ...settings, captionWeight: Number(v) })}
                    data={WEIGHTS}
                    fullWidth
                  />
                </div>
                <div>
                  <div className="field-label">
                    浮层背景透明度（{Math.round(settings.captionOpacity * 100)}%）
                  </div>
                  <Slider
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={settings.captionOpacity}
                    onChange={(v) => update({ ...settings, captionOpacity: v })}
                    label={(v) => `${Math.round(v * 100)}%`}
                  />
                </div>
              </div>
              <div className="field-2col">
                <div>
                  <div className="field-label">字体族</div>
                  <Select
                    value={settings.captionFont}
                    onChange={(v) => v && update({ ...settings, captionFont: v })}
                    data={CAPTION_FONTS.map((f) => ({ value: f.key, label: f.label }))}
                    allowDeselect={false}
                  />
                </div>
                <div>
                  <div className="field-label">浮层边框质感</div>
                  <Select
                    value={settings.captionTexture}
                    onChange={(v) =>
                      v && update({ ...settings, captionTexture: v as CaptionTexture })
                    }
                    data={[
                      { value: 'solid', label: '纯色（默认）' },
                      { value: 'glass', label: '毛玻璃' },
                      { value: 'none', label: '无边框纯文字' }
                    ]}
                    allowDeselect={false}
                  />
                </div>
              </div>
              <div className="behavior-row">
                <span className="engine-info">
                  <span className="engine-name">文字阴影</span>
                  <span className="engine-hint">复杂画面背景下提升字幕可读性</span>
                </span>
                <Switch
                  checked={settings.captionShadow}
                  onChange={(e) => update({ ...settings, captionShadow: e.currentTarget.checked })}
                />
              </div>
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
              <div className="field-label">服务商预设</div>
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
                  onClick={() => setPresetOverride('custom')}
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
                <TextInput
                  label="Base URL"
                  labelProps={{ className: 'field-label' }}
                  value={settings.llm.baseUrl}
                  onChange={(e) =>
                    update({ ...settings, llm: { ...settings.llm, baseUrl: e.currentTarget.value } })
                  }
                  placeholder="https://api.openai.com/v1"
                />
                <TextInput
                  label="模型"
                  labelProps={{ className: 'field-label' }}
                  value={settings.llm.model}
                  onChange={(e) =>
                    update({ ...settings, llm: { ...settings.llm, model: e.currentTarget.value } })
                  }
                  placeholder="gpt-4o-mini"
                />
              </div>
              <PasswordInput
                label="API Key"
                labelProps={{ className: 'field-label' }}
                value={settings.llm.apiKey}
                onChange={(e) =>
                  update({ ...settings, llm: { ...settings.llm, apiKey: e.currentTarget.value } })
                }
                placeholder="sk-..."
              />
              <div className="card-divider" />
              <div className="llm-test-row">
                <Button
                  variant="light"
                  loading={llmTestState === 'testing'}
                  onClick={() => void runLlmTest()}
                >
                  测试接口连通性
                </Button>
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
                  <div className="stat-num">{masteredCount ?? '-'}</div>
                  <div className="stat-label">已掌握（词）</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-num">{todayStats.reviewed}</div>
                  <div className="stat-label">今日复习（次）</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-num">{todayStats.rate}</div>
                  <div className="stat-label">今日认识率</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-num">{favCount ?? '-'}</div>
                  <div className="stat-label">精读收藏（部）</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-num">{captionCacheCount ?? '-'}</div>
                  <div className="stat-label">字幕缓存（部）</div>
                </div>
              </div>
              <div className="card-divider" />
              <div className="data-row">
                <Button variant="default" onClick={() => void exportData()}>
                  导出数据（JSON）
                </Button>
                <Button
                  variant="default"
                  title="从备份文件恢复（导入后自动重载）"
                  onClick={() => void importData()}
                >
                  导入数据
                </Button>
                <Button
                  variant="default"
                  title="清空本地字幕缓存（不影响生词/收藏），下次打开视频会重新抓取"
                  onClick={() =>
                    void api.captionsClearCache().then(() => {
                      setCaptionCacheCount(0)
                      setDataMsg('字幕缓存已清除')
                    })
                  }
                >
                  清除字幕缓存
                </Button>
                {dataMsg && <span className="saved-hint">{dataMsg}</span>}
              </div>
              {/* 手机同步：局域网 HTTP 服务，手机端输入地址拉取/推送生词本与跟读脚本 */}
              <div className="data-row">
                {!syncAddr ? (
                  <Button variant="default" onClick={() => void startSync()}>
                    开启手机同步
                  </Button>
                ) : (
                  <>
                    <span className="saved-hint">手机端输入：{syncAddr}</span>
                    <Button
                      variant="subtle"
                      onClick={() => {
                        void api.syncStop()
                        setSyncAddr('')
                      }}
                    >
                      关闭
                    </Button>
                  </>
                )}
              </div>
              {/* 危险操作：原地两段确认，不弹系统对话框 */}
              <div className="data-row danger-zone">
                {!confirmReset ? (
                  <Button variant="subtle" color="red" onClick={() => setConfirmReset(true)}>
                    恢复默认设置
                  </Button>
                ) : (
                  <span className="reset-confirm">
                    确定恢复默认设置？（生词/收藏不受影响）
                    <Button
                      color="red"
                      onClick={() => {
                        void api.settingsSet(DEFAULT_SETTINGS).then(() => window.location.reload())
                      }}
                    >
                      确认重置
                    </Button>
                    <Button variant="default" onClick={() => setConfirmReset(false)}>
                      取消
                    </Button>
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
              {/* 真实字幕浮层组件：文本固定，悬停/点词/翻译弹窗与浏览页行为一致 */}
              <CaptionOverlay
                cues={SAMPLE_CUES}
                time={1}
                opacity={settings.captionOpacity}
                fontSize={settings.captionFontSize}
                zhSize={settings.captionZhSize}
                fontFamily={captionFontCss(settings.captionFont)}
                weight={settings.captionWeight}
                shadow={settings.captionShadow}
                texture={settings.captionTexture}
                showZh
                zhLines={SAMPLE_ZH}
                knownWords={knownWords}
                onWordSelect={setSelection}
                onCaptionEnter={noop}
                onCaptionLeave={noop}
              />
            </div>
            <div className="stage-meta">
              字号 {settings.captionFontSize}px · 透明度 {Math.round(settings.captionOpacity * 100)}%
              · 悬停/点击单词试试
            </div>
          </div>
        </aside>
      </div>
      {selection && (
        <TranslatePopup
          key={selection.text}
          text={selection.text}
          rect={selection.rect}
          sentence={selection.sentence}
          video={{ videoId: 'preview-stage', title: '字幕预览舞台' }}
          time={0}
          savedItem={findSavedByLemma(vocabList ?? [], selection.text)}
          onClose={() => setSelection(null)}
        />
      )}
    </PageShell>
  )
}
