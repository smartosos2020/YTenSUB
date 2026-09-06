@echo off
rem YTenSUB 精选内容管线（Windows 任务计划调用）
cd /d D:\work\AiDevSrc\engLearn
call npm run pipeline >> "%APPDATA%\YTenSUB\pipeline.log" 2>&1
