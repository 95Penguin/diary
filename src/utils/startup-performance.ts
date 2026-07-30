type StartupMetricName = 'database' | 'preferences' | 'home';

const appStartedAt = Date.now();
const metrics: Partial<Record<StartupMetricName, number>> = {};
let firstScreenReadyAt: number | null = null;

export function startupTimer() {
  return Date.now();
}

export function finishStartupMetric(name: StartupMetricName, startedAt: number) {
  if (metrics[name] == null) metrics[name] = Math.max(0, Date.now() - startedAt);
  if (name === 'home' && firstScreenReadyAt == null) firstScreenReadyAt = Date.now();
}

export function getStartupMetrics() {
  return {
    elapsed: Math.max(0, (firstScreenReadyAt ?? Date.now()) - appStartedAt),
    database: metrics.database ?? null,
    preferences: metrics.preferences ?? null,
    home: metrics.home ?? null,
  };
}

export function formatStartupMetrics() {
  const value = getStartupMetrics();
  const duration = (item: number | null) => item == null ? '尚未完成' : `${item} 毫秒`;
  return [
    `首屏可用：${value.elapsed} 毫秒`,
    `数据库初始化：${duration(value.database)}`,
    `偏好设置读取：${duration(value.preferences)}`,
    `首页首批记录：${duration(value.home)}`,
  ].join('\n');
}
