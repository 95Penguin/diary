# 拾时 Mobile

拾时是一款本地优先的个人生活记录应用：记下此刻，也在未来重新拾起它。

当前版本为 `1.0.10`，Android 包名为 `com.penguin95.shishi`。应用以 Android
真机自用为主要场景，同时保留 iOS 与 Web 工程能力。

## 主要功能

### 记录与回看

- 记录正文、图片、视频、发生时间、心情、天气、地点和标签
- 为已有记录追加带独立时间和媒体的“后续”
- 时间轴分页加载、组合筛选、收藏、草稿、全文搜索和编辑历史
- 日历回看与年月跳转
- 随机拾起旧记录、近况总结、年度回顾和年度足迹热力图

### 内容组织

- 创建个人写作模板，修改或恢复系统模板
- 管理、重命名、合并标签与地点
- 批量修改标签、地点和收藏状态，或批量移入回收站
- 按年月浏览媒体、全屏预览并返回所属记录
- 生成可自定义信息范围的记录分享卡片

### 地点与足迹

- 主动定位、地点搜索和地图选点
- 高德足迹地图、区域聚合、时间筛选和地点详情
- 旧记录补点、相近地点检查、地点别名与坐标隐私处理

定位仅在用户主动记录、搜索或选点时使用，不进行后台轨迹追踪。足迹地图用于生活
回看，不替代导航或专业地图服务。

### 长期保存

- 完整 ZIP 备份、恢复预览、媒体校验和恢复前安全快照
- 固定目录自动备份与可选 WebDAV 自动备份
- Markdown / HTML 阅读导出
- 数据体检、媒体维护、存储空间管理和 30 天回收站
- 时间胶囊、到期提醒、开启后回应及完整备份恢复

## 数据与隐私

- 数据默认保存在设备本地，不依赖账号或自建服务端
- SQLite 使用 WAL、外键、索引和版本迁移
- 记录的发生时间与真正写入时间分别保存
- 应用锁使用系统生物识别；诊断日志会隐藏密钥、精确坐标和本地路径
- 卸载应用会清除尚未导出的应用数据，升级或换机前请先导出完整 ZIP 备份
- WebDAV 仅在用户主动配置后启用

完整备份覆盖记录、后续、媒体、时间胶囊及回应、标签、编辑历史、地点目录、个人资料、
显示设置和自定义模板。恢复采用合并策略，并在完成前校验文件和数据库关系。

## 技术栈

- Expo SDK 57
- React Native 0.86
- React 19 + TypeScript 6
- Expo Router
- Expo SQLite
- 高德 Android 地图 SDK

## 工程结构

```text
src/app/          页面与路由
src/components/   通用组件和业务组件
src/database/     SQLite 迁移与数据访问
src/domain/       领域模型
src/hooks/        页面与业务 Hooks
src/preferences/  用户设置
src/utils/        备份、媒体、日期等工具
tests/            数据层与核心规则测试
docs/             产品、版本、路线和真机检查文档
```

## 开发环境

安装依赖并启动 Metro：

```bash
npm install
npm start
```

运行本地原生工程：

```bash
npm run android
npm run ios
```

应用锁、通知、系统日期时间选择、媒体压缩、分享、内置字体和地图均涉及原生能力。
完整调试请使用 Development Build 或重新构建 APK；Expo Go 只适合基础页面和部分流程。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动 Expo 开发服务 |
| `npm run android` | 构建并运行 Android 原生工程 |
| `npm run lint` | ESLint 检查 |
| `npx tsc --noEmit` | TypeScript 类型检查 |
| `npm run test:data` | 数据层与核心规则测试 |
| `npm run version:check` | 检查应用、构建和数据库版本一致性 |
| `npx expo-doctor` | 检查 Expo 依赖兼容性 |

## 高德地图配置

Android 地图构建需要在 EAS 对应环境中配置 `AMAP_ANDROID_API_KEY`。密钥不要写入
仓库，也不要出现在截图、日志或 Release 说明中。

```bash
npx eas-cli env:list --environment preview
```

高德控制台中的 Android Key 必须匹配：

- PackageName：`com.penguin95.shishi`
- SHA-1：当前 EAS Android 发布证书的 SHA-1

修改密钥、包名、证书、原生字体或地图 SDK 后必须重新构建，OTA 更新不能替换这些
原生配置。

## 质量检查

提交或构建前执行：

```bash
npm run version:check
npx tsc --noEmit
npm run lint
npm run test:data
npx expo-doctor
```

涉及交互、地图、媒体、通知、应用锁或备份时，还应按
[构建前真机检查](docs/prebuild-device-checklist.md)完成对应流程。

## Android 构建

个人版仅包含 `arm64-v8a`，适合当前主流 Android 真机，体积相对较小：

```bash
npm run build:android:personal
```

通用预览版包含更多 CPU 架构，体积更大，适合作为兼容性安装包：

```bash
npm run build:android:preview
```

生产配置生成 Android App Bundle：

```bash
npm run build:android:production
```

personal 与 preview 使用相同包名和版本号，不能作为两个独立应用同时安装。构建完成后
建议按以下格式命名：

```text
shishi-v1.0.10-personal-arm64.apk
shishi-v1.0.10-preview-universal.apk
```

当前版本号位置：

- `package.json`：`version`
- `app.json`：`expo.version`
- `app.json`：Android `versionCode`、iOS `buildNumber`

版本和数据库发布规则见 [docs/versioning.md](docs/versioning.md)。

## GitHub Release

发布前先提交并推送代码：

```bash
git status --short
git add -A
git commit -m "feat: release v1.0.10"
git push origin main
```

创建并推送标签：

```bash
git tag -a v1.0.10 -m "Release v1.0.10"
git push origin v1.0.10
```

首次创建 Release：

```bash
gh release create v1.0.10 \
  /Users/95penguin/Downloads/shishi-v1.0.10-personal-arm64.apk \
  --repo 95Penguin/diary \
  --title "拾时 v1.0.10" \
  --generate-notes
```

如果 Release 已存在，只替换同名附件：

```bash
gh release upload v1.0.10 \
  /Users/95penguin/Downloads/shishi-v1.0.10-personal-arm64.apk \
  --repo 95Penguin/diary \
  --clobber
```

查看 Release：

```bash
gh release view v1.0.10 --repo 95Penguin/diary --web
```

不要默认强制覆盖已经公开的标签。若代码或安装包已经变化，优先递增版本号并发布新
Release；只有明确需要修正同一版本时，才同步更新标签和附件。

## 相关文档

- [产品需求文档](docs/PRD.md)
- [版本与数据库发布规则](docs/versioning.md)
- [构建前真机检查](docs/prebuild-device-checklist.md)
- [未来路线](docs/roadmap.md)

## 当前产品边界

拾时面向个人自用、轻量记录和长期保存，暂不提供社交、后台连续轨迹、自动停留识别、
复杂旅行规划或账号云同步。后续优先处理稳定性、兼容性和界面细节。
