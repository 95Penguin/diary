# 拾时 Mobile

拾时是一款本地优先的生活记录应用，用来记下此刻，并在未来重新拾起它。

当前版本为 `1.0.5`，Android 应用包名为 `com.penguin95.shishi`，Android
`versionCode` 为 `7`。版本规则与数据库基线见
[docs/versioning.md](docs/versioning.md)，构建前建议按
[构建前真机检查](docs/prebuild-device-checklist.md)完成一次关键流程验收。

## 当前能力

- 记录：正文、图片与视频、发生时间、心情、天气、地点、标签和日记模板
- 时间轴：按日期分组，支持搜索、筛选、收藏、草稿和记录详情
- 日历与回忆：按日期回看，随机拾起记录并生成时光总结
- 后续：为已有记录补充带独立时间的内容
- 批量管理：批量修改标签、地点、收藏状态或移入回收站
- 标签与地点：新增、重命名、合并、删除和常用项管理
- 地点记录：自动定位、地图选点、地点搜索、历史地点和精简显示名称
- 足迹地图：高德地图、叶子标记、区域聚合、时间筛选、地点列表与详情
- 地点整理：旧记录补点、相近地点检查、地点别名与坐标隐私处理
- 备份与恢复：完整 ZIP 备份、恢复预览、完整性检查和备份提醒
- 阅读导出：按时间范围生成 Markdown 或 HTML 文件
- 个性化：头像、昵称、个性签名、背景主题、字号和内置正文字体
- 隐私与诊断：应用锁、本地脱敏错误日志、定位诊断和诊断信息导出
- 本地存储：SQLite、WAL、外键、索引、版本迁移和 30 天回收站

## 产品边界

拾时目前以个人自用、轻量记录和尽量低成本为目标：

- 数据默认只保存在设备本地，不依赖账号或云端服务
- 定位只在用户主动记录或选点时使用，不进行后台轨迹追踪
- 足迹地图用于大致回看去过的区域，不替代专业地图或导航应用
- 暂不加入社交、连续轨迹、自动停留识别和复杂旅行规划

`1.0.5` 之后优先处理稳定性、兼容性和界面细节，暂不继续扩展新功能。

## 技术栈

- Expo SDK 57
- React Native 0.86
- TypeScript
- Expo Router
- Expo SQLite
- 高德 Android 地图 SDK

## 本地运行

```bash
npm install
npm start
```

应用锁、通知、压缩、分享、内置字体和地图均涉及原生能力。完整调试请使用
Development Build 或重新构建 APK；Expo Go 只适合部分页面与基础流程。

## 构建前检查

```bash
npm run version:check
npx tsc --noEmit
npm run lint
npm run test:data
```

## 高德地图配置

Android 地图构建需要在 EAS 的 `preview` 环境中配置
`AMAP_ANDROID_API_KEY`。密钥不要写入仓库，也不要出现在截图或日志中。

检查变量是否存在：

```bash
npx eas-cli env:list preview
```

高德控制台中的 Android Key 还需要与以下信息匹配：

- PackageName：`com.penguin95.shishi`
- 发布版安全码 SHA-1：当前 EAS Android 发布证书的 SHA-1

修改密钥、包名、证书、原生字体或地图 SDK 后，必须重新构建 APK，OTA 更新
不能替换这些原生配置。

## 构建两种 Android APK

个人版只包含 `arm64-v8a`，体积较小，适合当前主流 Android 真机自用：

```bash
npm run build:android:personal
```

通用预览版包含更多 Android CPU 架构，文件较大，但兼容范围更广：

```bash
npm run build:android:preview
```

两个构建都使用 EAS `preview` 环境并生成 APK。它们的包名和版本号相同，不能
作为两个独立应用共存；在同一手机安装第二个通常会覆盖升级第一个。日常自用优先
安装 personal 版，preview 版可作为兼容性备用包发布。

构建完成后从 EAS 结果页分别下载并建议重命名为：

- `shishi-v1.0.5-personal-arm64.apk`
- `shishi-v1.0.5-preview-universal.apk`

## 提交与发布

提交当前版本代码：

```bash
git add README.md src/app/backup.tsx src/app/footprint-map.tsx src/app/index.tsx \
  'src/app/location/[name].tsx' src/app/summaries.tsx \
  src/components/location-picker-modal.tsx
git commit -m "release: prepare v1.0.5"
git push origin main
```

确认两个 APK 已下载到 `Downloads` 并按上面的名称保存后，创建 GitHub Release：

```bash
gh release create v1.0.5 \
  /Users/95penguin/Downloads/shishi-v1.0.5-personal-arm64.apk \
  /Users/95penguin/Downloads/shishi-v1.0.5-preview-universal.apk \
  --repo 95Penguin/diary \
  --title "拾时 v1.0.5" \
  --generate-notes
```

如果 Release 已经创建，只需要补传文件：

```bash
gh release upload v1.0.5 \
  /Users/95penguin/Downloads/shishi-v1.0.5-personal-arm64.apk \
  /Users/95penguin/Downloads/shishi-v1.0.5-preview-universal.apk \
  --repo 95Penguin/diary
```

## 数据说明

数据库文件名为 `shishi.db`。记录时间以 ISO 8601 UTC 字符串保存，界面按设备
当前时区展示；事情发生时间和真正写入时间分别保存，不会互相覆盖。

删除采用软删除，并在回收站保留 30 天。升级或覆盖安装前仍建议先导出完整 ZIP
备份；卸载应用会清除应用沙盒内尚未导出的本地数据。
