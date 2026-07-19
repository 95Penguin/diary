# 拾时 Mobile

拾时的 React Native + Expo 手机客户端。当前实现 PRD 中的 P0 核心记录闭环。

## 当前能力

- “记录此刻”：纯文字、自动时间、修改发生时间
- 时间轴：按发生时间倒序和日期分组
- 记录详情：编辑、删除和查看原始记录时间
- “添加后续”：新增、编辑和删除带独立时间的后续
- 日历：按日期查看当天记录
- 搜索：同时搜索记录正文与后续
- 草稿：新建记录时自动保存和恢复
- SQLite：本地持久化、WAL、外键、索引和版本迁移

## 技术栈

- Expo SDK 57
- React Native 0.86
- TypeScript
- Expo Router
- Expo SQLite

## 运行

```bash
npm install
npm start
```

启动后可以通过 Expo Go 扫码进行 P0 调试。开始实现应用锁、原生分享或其他自定义原生能力时，改用 Expo Development Build。

## 检查

```bash
npx tsc --noEmit
npm run lint
npx expo export --platform android
```

## 数据说明

数据库文件名为 `shishi.db`。记录时间以 ISO 8601 UTC 字符串保存，界面按设备当前时区展示。事情发生时间和真正写入时间分别保存，不会互相覆盖。

当前删除采用软删除，为后续回收站和多设备删除同步预留。P0 尚未包含图片、账号、同步和应用锁。
