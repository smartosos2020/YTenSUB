# YTenSUB

桌面端 YouTube 英语学习器：内嵌 youtube.com，自动提取英文字幕，中文字幕对照，划词翻译，生词本，视频收藏。

## 功能

- **浏览**：内嵌打开 YouTube，打开视频页自动加载英文字幕面板，字幕随播放进度高亮，点击字幕跳转
- **中文字幕**：视频字幕下方与字幕列表每条英文下方紧贴显示中文；优先使用视频自带中文字幕，其次 YouTube 机器翻译轨，都没有时用 Google 整句翻译代替；字幕列表顶部滑动开关控制显隐（默认关闭），支持 ±0.5s 时间微调
- **划词翻译**：字幕、网页评论区等任意文本选中即弹出翻译；翻译链按 本地词典 → Google 免费接口 → LLM API 顺序回退（设置页可开关各级、配置 LLM）；悬停字幕自动暂停播放方便取词
- **生词本**：一键收藏单词，记录翻译、所在句子、来源视频和时间点，可点击跳回视频对应位置；支持导出 CSV（Anki 可导入）
- **复习**：卡片翻转式复习，按 10分钟/1/3/7/15/30天 间隔重复；满级单词标记"已掌握"并从字幕高亮中移除
- **收藏**：视频收藏到本地，支持文件夹分类，缩略图网格 / 列表两种展示
- **播放控制**：空格播放/暂停，←/→ 快退快进 5s，↑/↓ 跳上/下一句字幕，单句循环复读，单词真人发音（dictionaryapi.dev，系统 TTS 兜底）
- **数据**：设置页可导出/导入全部数据（生词、收藏、设置）；写入自动留 .bak 防损坏

## 开发

```bash
npm install        # 安装依赖
npm run build:dict # 生成本地词典 resources/dict.json（从 ECDICT 拉取，失败则写入最小词表）
npm run dev        # 开发模式启动
npm test           # 单元测试
npm run lint       # ESLint
npm run build      # 构建到 out/
npm run dist       # 打包 Windows 安装包（electron-builder）
```

## 技术栈

Electron + electron-vite + React + TypeScript。数据存于用户目录 `ytensub-data.json`（收藏、文件夹、生词、设置；首次启动自动迁移旧 EngLearn 数据），写入前自动备份 `.bak`。自动更新走 GitHub Releases（electron-updater）。

## 结构

- `src/main/` — 主进程：`store.ts`（JSON 存储）、`dict.ts`（本地词典）、`translate.ts`（翻译回退链与整句批量翻译）、`index.ts`（窗口、IPC、自动更新）
- `src/preload/` — 宿主 preload（contextBridge API）与注入 YouTube 页面的 `webview-preload.ts`（导航检测、进度上报、页面划词上报；仅 youtube.com 生效）
- `src/renderer/` — React 界面：浏览 / 收藏 / 生词本 / 复习 / 设置五个页面；`hooks/` 为浏览页拆分的自定义 hooks，`components/icons/` 为内联 SVG 图标
- `src/shared/` — 主进程与渲染进程共享的类型与纯函数（字幕解析、中英字幕对齐、双语 SRT 导出等）
- `scripts/build-dict.mjs` — 词典构建脚本
- `tests/` — vitest 单元测试（含 jsdom 渲染层测试）
