# 拾时

拾时是一款本地优先的个人生活记录应用，用来记下日常，也在以后重新拾起这些时刻。

应用主要面向 Android 真机使用。当前版本号以 `package.json` 和 `app.json` 为准。

## 功能

- **记录**：正文、图片、视频、时间、心情、天气、地点和标签；支持后续、草稿、收藏、搜索与编辑历史。
- **回看**：时间轴、日历、随机回忆、年度足迹热力图和近况回顾。
- **时光工具**：时光总结、时间胶囊、足迹地图、时光像素和睡眠记录与统计。
- **整理**：写作模板、媒体浏览、标签与地点管理、批量管理、分享卡片和回收站。
- **保存**：完整 ZIP 备份与恢复、固定目录自动备份、可选 WebDAV 备份、数据体检和应用锁。

日记数据默认保存在设备本地，不需要账号。地图及用户主动配置的 WebDAV 功能会使用相应的外部服务。卸载或换机前，请导出并妥善保存完整 ZIP 备份。

## 开发

需要 Node.js；运行本地 Android 原生工程还需要 Android 开发环境。在本目录安装依赖并启动：

```bash
npm install
npm start
```

运行 Android 原生工程：

```bash
npm run android
```

地图、通知、应用锁和部分媒体功能需要原生构建，不能只依靠 Expo Go 验证。

## 检查与构建

提交或构建前运行：

```bash
npm run version:check
npx tsc --noEmit
npm run lint
npm run test:data
```

个人使用的 Android APK：

```bash
npm run build:android:personal
```

兼容更多 Android 架构的预览 APK 使用 `npm run build:android:preview`；商店发布包使用 `npm run build:android:production`。构建配置见 `eas.json`。

地图构建所需的 `AMAP_ANDROID_API_KEY` 应配置在对应的 EAS 环境中，不要提交到仓库。实际发布前请按[真机检查清单](docs/prebuild-device-checklist.md)验证安装、数据恢复和原生功能。

## 文档

- [产品需求](docs/PRD.md)
- [版本与数据库发布规则](docs/versioning.md)
- [构建前真机检查](docs/prebuild-device-checklist.md)
- [后续计划](docs/roadmap.md)
