# 版本与数据库发布规则

## 当前基线

- 用户可见版本：`1.0.6`
- Android `versionCode`：`8`
- iOS `buildNumber`：`7`
- SQLite schema：`17`
- SQLite 正式基线：`13`

`app.json` 是应用版本的源文件，`package.json` 的 `version` 必须与其一致。
运行 `npm run version:check` 可检查版本配置与数据库版本是否有效。

`1.0.5` 已于 2026 年 8 月 1 日构建；当前仓库中的后续功能归入 `1.0.6`。发布或分发 `1.0.6` 后，下一次构建必须使用新的用户版本或至少继续递增平台构建号。

## 数据库规则

schema 1–12 是开发期间的临时结构，已停止提供逐级迁移。schema 13 是第一版正式基线：

- 新安装直接创建当前完整 schema。
- schema 13、14、15、16 通过顺序迁移升级到 schema 17，现有记录表不会重建。
- schema 1–12 会停止启动迁移并提示先用旧开发版导出 ZIP，再在当前版本恢复。
- schema 14 增加查询索引，schema 15 增加时间胶囊主体表，schema 16 增加提醒设置和胶囊回应，schema 17 增加胶囊媒体。
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
