<p align="center">
  <img src="resources/icon.png" alt="YTenSUB Logo" width="112" height="112">
</p>

<h1 align="center">YTenSUB</h1>

<p align="center">
  <strong>把英文视频变成可积累的学习材料。</strong><br>
  双语字幕 · 语境查词 · 生词复习 · 跟读练习
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-Desktop-0078D4?style=flat-square" alt="Windows 桌面端">
  <img src="https://img.shields.io/badge/Android-Mobile-3DDC84?style=flat-square" alt="Android 移动端">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
</p>

<p align="center">
  <a href="https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/releases/YTenSUB-Setup-latest.exe">下载 Windows 版</a>
  · <a href="#核心功能">核心功能</a>
  · <a href="#本地开发">本地开发</a>
  · <a href="server/README.md">服务端部署</a>
  · <a href="https://github.com/smartosos2020/YTenSUB/issues">反馈问题</a>
</p>

---

YTenSUB 是面向英语学习的 Windows 桌面应用与 Android 客户端，将观看、查词、收藏、复习和跟读串联在同一套学习流程中。桌面端同时支持 YouTube 浏览、本地视频播放、字幕检索和 P2P 资源下载；手机端提供适合竖屏使用的字幕与复习体验。

## 核心功能

| 能力 | 说明 |
| --- | --- |
| 双语字幕 | 英文字幕与中文对照，随播放定位和高亮；支持通过字幕跳转、重复听读。 |
| 语境查词 | 在字幕或网页中点词、划词，查看释义与发音；支持本地词典、在线翻译及可选的 OpenAI 兼容 LLM。 |
| 生词与复习 | 生词关联来源视频和例句，支持词形归一与间隔重复；桌面端可导出 CSV，供 Anki 等工具使用。 |
| 图片辅助记忆 | 为适合图示的词匹配概念图标或开放图库图片；桌面端图片缓存上限为 10 MB。 |
| 精选与收藏 | 按英语难度和主题筛选精选内容，收藏视频以便后续学习。 |
| 跟读练习 | 桌面端从字幕生成跟读脚本，提供提词器、示范音与背景音乐；脚本可同步到手机。 |
| 本地视频 | 桌面端支持文件夹播放列表、本地字幕及 OpenSubtitles 英文字幕检索。 |
| 资源下载 | 桌面端提供视频资源搜索、磁力链接和种子下载，可选择文件、暂停续传，并将完成的视频交给本地播放器。 |
| 移动学习 | Android 竖屏播放与滚动字幕，支持后台播放及通知栏、锁屏播放控制。 |
| 设备间同步 | 通过局域网配对合并生词本与跟读脚本；账号服务用于会员权益和精选偏好同步。 |

### 本地视频与字幕

- 添加视频或文件夹后，直接在播放列表切换剧集，文件夹支持折叠。
- 自动查找视频目录及其子目录中的本地字幕。
- 在线字幕由用户点击搜索，选择具体条目后再下载。
- 下载的字幕保存到视频同目录下的 `dSub/`，便于下次加载。
- 切换模块时暂停并保留播放会话，返回后继续观看。

支持打开 MP4、M4V、WebM、MOV、MKV、AVI 等扩展名；实际可播放性取决于文件中的音视频编码。

### 资源搜索与下载

资源模块通过 ApiBay 搜索视频条目，使用 rqbit 作为下载引擎，支持磁力链接、本地 `.torrent`、文件选择和下载状态管理。下载速度取决于资源的节点、做种情况和网络环境。

下载引擎按需启动，退出应用时保存任务状态。详细行为、代理支持与引擎授权见 [桌面资源模块说明](docs/resources.md)。

## 下载与安装

| 平台 | 获取方式 | 更新方式 |
| --- | --- | --- |
| Windows | [下载最新安装包](https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/releases/YTenSUB-Setup-latest.exe) | 安装后支持应用内检查和安装更新。 |
| Android | 从 `mobile/` 构建，见下方开发说明。 | 安装新的 Android 构建。 |

Windows 安装包与自动更新文件通过 Cloudflare R2 分发。

官方安装版连接项目官方服务。源码运行及普通自行打包默认连接本机 `http://127.0.0.1:8787`，且关闭自动更新，不会默认访问官方 Cloudflare。自建服务与官方发布的配置方式见下文。

### 开始学习

1. 在浏览页打开 YouTube 视频，或在桌面端本地模块打开视频文件。
2. 结合双语字幕观看，遇到生词时查看释义并加入生词本。
3. 收藏值得重复观看的视频，或生成跟读脚本进行口语练习。
4. 在复习模块完成到期卡片，将视频中的新词转化为长期积累。

本地词典和已保存的学习数据可离线使用。视频访问、在线翻译、图片匹配、字幕检索及资源搜索需要相应网络服务。

## 本地开发

### 环境要求

- Windows 桌面开发环境。
- Node.js 22.x（22.13 或更高版本）与 npm；测试使用内置 `node:sqlite`。
- Android 原生构建另需 Android SDK、JDK，以及模拟器或已授权的 Android 真机。

### Windows 桌面端

```bash
git clone https://github.com/smartosos2020/YTenSUB.git
cd YTenSUB
npm ci
npm run build:dict
npm run dev
```

`build:dict` 从 ECDICT 生成桌面端和手机端共用的离线词典。也可使用本地 CSV：

```bash
npm run build:dict -- path/to/ecdict.csv
```

首次执行 `dev`、`build` 或 `dist` 时，会下载固定版本的 Windows rqbit 引擎并校验 SHA-256；本地已有正确版本时直接复用。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron 开发版。 |
| `npm run build` | 构建主进程、预加载脚本与界面。 |
| `npm run lint` | 执行代码检查。 |
| `npx tsc --noEmit` | 执行 TypeScript 类型检查。 |
| `npm test` | 运行根目录测试。 |
| `npm run dist` | 生成自行分发的 Windows 安装包；默认连接本地服务，关闭自动更新。 |
| `npm run dist:official` | 显式加载本机发布配置，生成连接指定服务并带更新源的安装包。 |
| `npm run release` | 使用本机发布配置打包，并上传到配置的 Cloudflare R2 发布位置。 |

### Android 客户端

```bash
cd mobile
npm ci
npm run android
```

手机端包含后台播放等自定义原生模块，需要开发构建。安装开发客户端后，可单独启动 Metro：

```bash
npm start -- --dev-client
```

使用已连接、已授权的真机时，也可执行 `npm run dev:android`，通过项目脚本启动开发客户端。Android 的测试和类型检查在 `mobile/` 目录运行：

```bash
npx tsc --noEmit
npm test
```

## 配置与自建服务

### 客户端服务隔离

桌面端和 Android 共用账号及精选服务配置，但不内置官方生产地址：

| 场景 | 配置方式 | 默认值 |
| --- | --- | --- |
| 桌面开发、自行打包 | 根目录 `.env.local` 中的 `YTENSUB_API_URL` | `http://127.0.0.1:8787` |
| 桌面更新 | 同文件中的 `YTENSUB_UPDATE_URL` | 空，关闭更新检查、自动下载及安装包跳转 |
| Android 开发、自行打包 | `mobile/.env.local` 中的 `EXPO_PUBLIC_YTENSUB_API_URL` | `http://127.0.0.1:8787` |
| 采集与内容发布 | 根目录 `.env` 中的 `AUTH_API_URL` | 必须显式配置，不影响客户端地址 |

例如，自建服务的桌面配置：

```dotenv
YTENSUB_API_URL=https://your-api.example.com
# 可选；未设置时安装版也不检查更新。
YTENSUB_UPDATE_URL=https://your-download.example.com/releases
```

Android 可参考 [mobile/.env.example](mobile/.env.example)。真机访问本地 Worker 时可执行 `adb reverse tcp:8787 tcp:8787`；模拟器也可使用 `http://10.0.2.2:8787`，局域网连接则填写电脑 IP。未启动或未配置后端时，账号及精选在线功能不可用，本地学习功能仍可使用。修改地址后需重新启动开发进程或重新构建应用。

### 官方发布配置

维护者在根目录创建不提交 Git 的 `.env.release.local`，显式填写 `YTENSUB_API_URL` 和 `YTENSUB_UPDATE_URL`（均为 HTTPS），然后执行 `npm run dist:official` 或 `npm run release`。普通 `dev`、`build` 和 `dist` 不读取该发布文件。缺少发布地址时，官方打包在构建前直接失败。

Android 维护者可在 `mobile/` 执行 `npm run android:official`，使用同一发布配置构建并运行 release 版；使用 EAS 时，在对应构建环境显式配置 `EXPO_PUBLIC_YTENSUB_API_URL`。客户端变量均为公开地址，不能放管理令牌或 R2 密钥。

### 功能与运维配置

| 配置场景 | 入口 |
| --- | --- |
| 翻译与 LLM | 在桌面应用设置中选择翻译源，填写可选的 OpenAI 兼容服务地址、模型与 API Key。 |
| 在线英文字幕 | 在桌面应用设置中填写 OpenSubtitles API Key，再从本地播放器手动搜索。 |
| 精选内容采集 | 将根目录 [.env.example](.env.example) 复制为本地 `.env`，配置 YouTube API、Worker 地址和发布令牌。 |
| 桌面安装包发布 | 为发布脚本配置 `.env` 中的 R2 S3 凭据，执行 `npm run release`。 |
| 独立部署账号服务 | 按 [服务端部署指南](server/README.md) 创建自己的 Cloudflare 资源，更新 `server/wrangler.toml`，再通过上述环境变量配置客户端地址。 |

### 服务端架构

| 组件 | 职责 |
| --- | --- |
| Cloudflare Workers | 提供账号、权益、内容访问与管理后台 API。 |
| 私有 D1 数据库 | 存储账号、验证码、会员权益、卡密与入账凭证，事务处理兑换和补发。 |
| Workers KV | 存储会话、配置、精选偏好与频道订阅等数据。 |
| R2 | 存储精选内容和桌面安装包；客户端通过 Worker 获取受控内容。 |
| 本机采集端 | 执行内容采集任务，响应管理后台的手动触发并发布结果。 |

采集端配置完成后，可在项目根目录执行：

```bash
npm run pipeline                 # 本机执行一次内容采集
npm run pipeline:runner:start    # 启动供管理后台远程触发的本机执行端
```

服务端数据库初始化、旧 KV 数据迁移、历史卡密核对和运维说明见 [server/README.md](server/README.md)。

## 项目结构

```text
YTenSUB/
├── src/
│   ├── main/          # Electron 主进程、存储、字幕、下载与翻译
│   ├── preload/       # 桌面 IPC 与 WebView 桥接
│   ├── renderer/      # React 界面与学习模块
│   └── shared/        # 共享类型、协议与服务地址
├── mobile/            # Expo / React Native Android 客户端
├── server/            # Cloudflare Worker、D1 迁移与管理后台
├── scripts/           # 内容管线、词典构建和桌面发布脚本
├── resources/         # 项目 Logo、资源与第三方组件授权
├── tests/             # 桌面端、服务端与集成测试
└── docs/              # 功能与实现说明
```

## 反馈问题

欢迎通过 [GitHub Issues](https://github.com/smartosos2020/YTenSUB/issues) 反馈。请提供应用版本、操作系统、复现步骤，以及相关截图或日志，便于定位问题。

## 致谢与第三方资源

- **离线词典**：基于 [ECDICT](https://github.com/skywind3000/ECDICT) 构建。
- **下载引擎**：rqbit，授权与分发信息见 [RQBIT-NOTICE](resources/RQBIT-NOTICE.txt) 和 [Apache 2.0](resources/APACHE-2.0.txt)。
- **界面图标**：Lucide / Feather，授权说明见 [图标许可](resources/licenses/lucide.txt)。
- **生词图片**：使用 Noto Emoji、Openverse 与 Wikimedia Commons 等资源；图片结果附带来源和授权信息。
- **跟读背景音乐**：Gymnopedie No 1 — Kevin MacLeod（incompetech.com），CC BY 4.0。
