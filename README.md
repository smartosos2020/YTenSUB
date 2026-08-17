# YTenSUB

桌面端 YouTube 英语学习器：内嵌 youtube.com，自动提取英文字幕，中文字幕对照，划词翻译，生词本，视频收藏。

## 功能

- **浏览**：内嵌打开 YouTube，打开视频页自动加载英文字幕面板，字幕随播放进度高亮，点击字幕跳转
- **中文字幕**：视频字幕下方与字幕列表每条英文下方紧贴显示中文；优先使用视频自带中文字幕，其次 YouTube 机器翻译轨，都没有时用 Google 整句翻译代替；字幕列表顶部滑动开关控制显隐（默认关闭）
- **划词翻译**：在字幕面板选中单词/短语，弹出翻译；翻译链按 本地词典 → Google 免费接口 → LLM API 顺序回退（设置页可开关各级、配置 LLM）
- **生词本**：一键收藏单词，记录翻译、所在句子、来源视频和时间点，可点击跳回视频对应位置
- **收藏**：视频收藏到本地，支持文件夹分类，缩略图网格 / 列表两种展示

## 开发

```bash
npm install        # 安装依赖
npm run build:dict # 生成本地词典 resources/dict.json（从 ECDICT 拉取，失败则写入最小词表）
npm run dev        # 开发模式启动
npm test           # 单元测试
npm run build      # 构建到 out/
npm run dist       # 打包 Windows 安装包（electron-builder）
```

## 技术栈

Electron + electron-vite + React + TypeScript。数据存于用户目录 `ytensub-data.json`（收藏、文件夹、生词、设置；首次启动自动迁移旧 EngLearn 数据）。

## 结构

- `src/main/` — 主进程：`store.ts`（JSON 存储）、`dict.ts`（本地词典）、`translate.ts`（翻译回退链与整句批量翻译）、`index.ts`（窗口与 IPC）
- `src/preload/` — 宿主 preload（contextBridge API）与注入 YouTube 页面的 `webview-preload.ts`（导航检测、进度上报）
- `src/renderer/` — React 界面：浏览 / 收藏 / 生词本 / 设置四个页面
- `src/shared/` — 主进程与渲染进程共享的类型与纯函数（字幕解析、中英字幕对齐等）
- `scripts/build-dict.mjs` — 词典构建脚本
- `tests/` — vitest 单元测试
