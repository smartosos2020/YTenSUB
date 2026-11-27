# 桌面资源模块

搜索使用 The Pirate Bay 的 ApiBay 接口，只保留视频分类；输入具体季集时严格匹配季集，并按做种人数排序。源站和节点的可用性会影响搜索与下载。

搜索磁力附带少量公有 HTTP/UDP Tracker，避免完全依赖 DHT。没有 Tracker 的公有种子也会补入。旧任务在引擎启动前修复缓存种子的顶层 Tracker 字段，保留 info 原始字节与哈希、文件选择和下载目录；原始文件自动备份。已知私有种子保持原样。界面区分下载中、等待数据和寻找节点，并显示发现、连接与失败的节点数。

下载使用官方 rqbit v9.1.0 Windows 引擎，支持磁力链接和本地 `.torrent`。解析只获取文件列表，点击“开始下载”后才下载选中的文件。每个资源使用“名称-哈希前缀”子文件夹，避免同名文件冲突。rqbit 可能为未选文件创建占位文件；跨文件分片可能包含相邻文件的少量数据。

首次打开资源页才启动引擎。切换页面不停止任务；退出应用时暂停并保存，随后停止引擎。下次打开资源页恢复任务列表，点击“继续”续传。默认下载完成后停止做种，上传限速 128 KB/s；用户可以修改限速和做种设置。搜索沿用应用代理；P2P 只接入应用设置中的 SOCKS5 代理，HTTP 代理不用于 P2P。

已完成的视频可以打开到本地播放器，所在目录自动加入播放列表。移除任务保留下载文件。引擎的 HTTP API 只监听本机回环地址，每次启动生成独立 Basic 凭据，渲染页面无法获取端口或凭据。

rqbit 重启时会校验磁盘上的已有分片，校验进度不代表重新下载。`completed.json` 只保存已校验完成任务的哈希与目录/文件选择摘要；校验期间条目保留在“已完成”，显示“正在校验本地文件”，完成校验后才能播放。校验发现缺失或错误时，界面按引擎实际状态更新；更换目录、文件选择或移除任务后，不沿用旧的完成记录。旧版本任务首次校验完成后会建立记录。

`userData/resource-downloads/engine.log` 保留引擎告警及每 30 秒一次的下载状态，单份约 256 KB、保留上一份；API 凭据不记录，URL 用户名、密码及查询参数会移除。

`npm run dev`、`npm run build`、`npm run dist` 会准备并校验固定版本的引擎（约 12.2 MiB），已有正确文件时不再下载。打包时放在 asar 外的 `resources/engines/rqbit.exe`，二进制不提交 Git。授权见 `resources/RQBIT-NOTICE.txt` 和 `resources/APACHE-2.0.txt`。

验证：`npm test`、`npx tsc --noEmit`、`npm run lint`、`npm run build`。真实 P2P 集成测试使用本机 tracker、独立做种进程和合成文件；PowerShell 中运行：

```powershell
$env:YTENSUB_TEST_RQBIT='1'
npx vitest run tests/resource-downloads.integration.test.ts
```

集成测试覆盖磁力解析、文件选择、传输、暂停、重启续传、完成后停止做种、视频路径检查，以及移除任务后保留文件。
