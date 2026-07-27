# 版本与数据库发布规则

## 当前基线

- 用户可见版本：`1.0.0`
- Android `versionCode`：`1`
- iOS `buildNumber`：`1`
- SQLite schema：`13`
- SQLite 正式基线：`13`

`app.json` 是应用版本的源文件，`package.json` 的 `version` 必须与其一致。
运行 `npm run version:check` 可检查版本配置与数据库版本是否有效。

## 数据库规则

schema 1–12 是开发期间的临时结构，已停止提供逐级迁移。schema 13 是第一版正式基线：

- 新安装直接创建完整的 schema 13。
- 已经处于 schema 13 的安装不会重建数据库，现有数据原样保留。
- schema 1–12 会停止启动迁移并提示先用旧开发版导出 ZIP，再在当前版本恢复。
- 下一次数据库结构变化使用 schema 14，并只保留 `13 -> 14` 的迁移。
- 每次新增 schema 必须提供升级测试、失败回滚测试和备份恢复测试。

不要为了让旧开发数据库“看起来可用”而猜测字段或降级 `PRAGMA user_version`。

## 应用版本规则

- 修复错误但不改变数据库结构：增加 patch，例如 `1.0.0 -> 1.0.1`。
- 新增兼容功能：增加 minor，例如 `1.0.0 -> 1.1.0`。
- 不兼容的产品或数据变化：增加 major。
- 每次准备 Android 安装包或商店包时，增加 `android.versionCode`。
- iOS 构建时同步增加 `ios.buildNumber`。
- `versionCode` 和 `buildNumber` 只增不减，也不能重复用于商店构建。

## EAS 构建

第一次使用前登录并关联项目：

```bash
npx eas-cli login
npx eas-cli init
```

开发构建（APK，需要 Metro，包含开发工具）：

```bash
npm run build:android:development
```

预览构建（APK，可直接安装，不需要 Metro）：

```bash
npm run build:android:preview
```

正式构建（AAB，用于 Google Play）：

```bash
npm run build:android:production
```

当前采用本地版本源，因此构建前必须提交 `app.json` 中的版本变化。这样 Git 提交、
APK/AAB 和数据库版本可以直接对应，不依赖 EAS 远程自增状态。

## 发布前检查

```bash
npm run version:check
npm run test:data
npx tsc --noEmit
npm run lint
```

正式发布前还应在真机执行一次 ZIP 导出、恢复、图片显示、视频封面和视频播放验收。
