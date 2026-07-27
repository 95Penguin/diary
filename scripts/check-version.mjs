import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DATABASE_BASELINE_VERSION, DATABASE_VERSION } from '../src/database/migrate.ts';

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(pkg.version, app.version, 'package.json 与 app.json 的 version 必须一致');
assert.match(app.version, /^\d+\.\d+\.\d+$/, 'version 必须使用 major.minor.patch');
assert.ok(Number.isInteger(app.android?.versionCode) && app.android.versionCode > 0);
assert.match(app.ios?.buildNumber ?? '', /^\d+$/);
assert.ok(DATABASE_VERSION >= DATABASE_BASELINE_VERSION);

console.log(
  `版本检查通过：App ${app.version}，Android ${app.android.versionCode}，`
  + `iOS ${app.ios.buildNumber}，数据库 ${DATABASE_VERSION}`,
);
