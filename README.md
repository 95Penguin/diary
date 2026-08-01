# 拾时 Mobile

拾时是一款本地优先的生活记录应用，用来记下此刻，并在未来重新拾起它。

当前版本为 `1.0.6`，Android 应用包名为 `com.penguin95.shishi`，Android
`versionCode` 为 `8`，iOS `buildNumber` 为 `7`。版本规则与数据库基线见
[docs/versioning.md](docs/versioning.md)，构建前建议按
[构建前真机检查](docs/prebuild-device-checklist.md)完成一次关键流程验收。

## 当前能力

- 记录：正文、图片与视频、发生时间、心情、天气、地点、标签和可自定义日记模板
- 模板：创建、编辑和删除个人模板；系统模板支持修改与恢复默认，并随完整备份迁移
- 时间轴：按日期分组，支持搜索、筛选、收藏、草稿和记录详情；详情返回时保留原浏览位置，再点底部时间轴可回到顶部
- 日历与回忆：按日期回看、快速跳转年月、随机拾起记录（避免连续重复）、生成时光总结和年度回顾，并按年份查看年度足迹热力图
- 时间胶囊：封存文字、图片或视频，通过系统日期时间选择器约定开启时间；支持隐私通知、开启后回应、媒体滑动预览、回收站与完整备份恢复
- 后续：为已有记录补充带独立时间的内容
- 媒体浏览：按年月集中查看图片和视频，可筛选、全屏预览并返回所属记录
- 分享卡片：将单条记录生成图片，地点、标签和后续仅在主动选择后展示
- 批量管理：批量修改标签、地点、收藏状态或移入回收站
- 标签与地点：新增、重命名、合并、删除和常用项管理
- 地点记录：自动定位、地图选点、地点搜索、历史地点和精简显示名称
- 足迹地图：高德地图、叶子标记、区域聚合、时间筛选、地点列表与详情
- 地点整理：旧记录补点、相近地点检查、地点别名与坐标隐私处理
- 备份与恢复：完整 ZIP 备份、恢复预览、完整性检查和备份提醒
- 数据体检：只读检查数据库关系、媒体文件、回收站与最近备份，并给出处理建议
- 阅读导出：按时间范围生成 Markdown 或 HTML 文件
- 个性化：头像、昵称、个性签名、米白/青色/夜间等背景主题、字号、内置正文字体和阅读舒适度
- 隐私与诊断：应用锁、本地脱敏错误日志、定位诊断和诊断信息导出
- 本地存储：SQLite、WAL、外键、索引、版本迁移和 30 天回收站

## 产品边界

拾时目前以个人自用、轻量记录和尽量低成本为目标：

- 数据默认只保存在设备本地，不依赖账号或云端服务
- 定位只在用户主动记录或选点时使用，不进行后台轨迹追踪
- 足迹地图用于大致回看去过的区域，不替代专业地图或导航应用
- 暂不加入社交、连续轨迹、自动停留识别和复杂旅行规划

`1.0.6` 之后优先处理稳定性、兼容性和界面细节；长期功能规划见
[拾时未来路线](docs/roadmap.md)。

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

应用锁、通知、系统日期时间选择器、压缩、分享、内置字体和地图均涉及原生能力。完整调试请使用
Development Build 或重新构建 APK；Expo Go 只适合部分页面与基础流程。

## 构建前检查

```bash
npm run version:check
npx tsc --noEmit
npm run lint
npm run test:data
npx expo-doctor
```

当前项目固定使用 Expo SDK 57；依赖版本以 `expo-doctor` 的兼容性检查结果为准。
发布 `v1.0.6` 前请保持 `package.json`、`app.json` 中的应用版本为 `1.0.6`，
Android `versionCode` 为 8，iOS `buildNumber` 为 7；后续再次构建发布时继续递增。

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

- `shishi-v1.0.6-personal-arm64.apk`
- `shishi-v1.0.6-preview-universal.apk`

## 提交与发布

确认上面的检查全部通过后，提交当前版本代码：

```bash
git status --short
git add -A
git commit -m "feat: release v1.0.6 with time capsules and long-term memories"
git push origin main
```

构建两个 APK：

```bash
npm run build:android:personal
npm run build:android:preview
```

确认两个 APK 已下载到 `Downloads` 并按上面的名称保存后，创建 GitHub Release：

```bash
gh release create v1.0.6 \
  /Users/95penguin/Downloads/shishi-v1.0.6-personal-arm64.apk \
  /Users/95penguin/Downloads/shishi-v1.0.6-preview-universal.apk \
  --repo 95Penguin/diary \
  --title "拾时 v1.0.6" \
  --generate-notes
```

如果 Release 已经创建，只需要补传文件：

```bash
gh release upload v1.0.6 \
  /Users/95penguin/Downloads/shishi-v1.0.6-personal-arm64.apk \
  /Users/95penguin/Downloads/shishi-v1.0.6-preview-universal.apk \
  --repo 95Penguin/diary
```

检查 Release 是否已经存在：

```bash
gh release view v1.0.6 --repo 95Penguin/diary
```

`v1.0.6` tag 或 Release 已存在时不要再次运行 `gh release create`，使用
`gh release upload ... --clobber` 替换同名 APK：

```bash
gh release upload v1.0.6 \
  /Users/95penguin/Downloads/shishi-v1.0.6-personal-arm64.apk \
  /Users/95penguin/Downloads/shishi-v1.0.6-preview-universal.apk \
  --repo 95Penguin/diary \
  --clobber
```

## 从浮华录迁移

仓库提供了本地转换脚本，可将“浮华录”的完整 JSON 与媒体目录转换为拾时可恢复的
ZIP。脚本不会修改原备份，默认读取仓库同级的 `浮华录` 目录：

```bash
node scripts/convert-fuhualu-backup.mjs
```

生成文件为 `浮华录/拾时导入备份.zip`。在拾时的“设置 → 备份与恢复”中选择该
ZIP 并执行合并恢复；正式导入前仍建议先导出一份拾时当前数据。

## 数据说明

数据库文件名为 `shishi.db`。记录时间以 ISO 8601 UTC 字符串保存，界面按设备
当前时区展示；事情发生时间和真正写入时间分别保存，不会互相覆盖。

删除采用软删除，并在回收站保留 30 天。升级或覆盖安装前仍建议先导出完整 ZIP
备份；卸载应用会清除应用沙盒内尚未导出的本地数据。

完整备份包含记录、后续、普通媒体、时间胶囊及其媒体和回应、标签、编辑历史、地点目录、
个人资料、显示设置与自定义模板。恢复采用合并策略；同 ID 记录依据更新时间处理，模板
冲突优先保留本机版本，避免覆盖本机尚未导出的修改。
