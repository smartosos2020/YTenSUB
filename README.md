# YTenSUB

用 YouTube 学英语：双语字幕、点词翻译、生词本、复习、跟读练习。支持 Windows 桌面端和 Android 手机端。

## 功能

- **看视频学英文**：打开 YouTube 视频自动加载英文字幕 + 中文对照，字幕随播放高亮
- **点词翻译**：字幕或网页里点/选任意单词即出释义和发音，可一键加入生词本
- **生词本**：收藏自动关联词形变化（runs/ran/running 算同一个词），可导出 CSV 导入 Anki
- **复习**：卡片式间隔重复，满级标记"已掌握"
- **跟读练习**：把收藏视频的字幕提炼成跟读脚本，提词器播放 + 示范音 + 背景音乐
- **收藏夹**：喜欢的视频本地收藏、分类管理
- **手机端**：竖屏播放 + 滚动字幕，支持息屏/后台播放，通知栏和锁屏可直接控制播放暂停

## 安装

- **Windows**：从 [GitHub Releases](https://github.com/smartosos2020/YTenSUB/releases) 下载安装包，安装后自动检查更新
- **Android**：本地构建安装（见下文开发）

## 开发

桌面端（Electron + React）：

```bash
npm install        # 安装依赖
npm run build:dict # 生成本地词典（可选，仓库已带）
npm run dev        # 开发模式
npm test           # 测试
npm run dist       # 打包 Windows 安装包
```

手机端（Expo / React Native，代码在 `mobile/`）：

```bash
cd mobile
npm install
npx expo start                  # Expo Go 扫码调试
npx expo run:android            # 或本地编译安装（需 Android SDK + 手机开 USB 调试）
```

## 音乐署名

跟读页背景音乐：Gymnopedie No 1 — Kevin MacLeod（incompetech.com），CC-BY 4.0。
