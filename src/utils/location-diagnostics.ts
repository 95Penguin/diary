import { Platform } from 'react-native';
import * as Location from 'expo-location';

export type LocationDiagnostics = {
  permission: string;
  canAskAgain: boolean;
  servicesEnabled: boolean | null;
  gpsAvailable: boolean | null;
  networkAvailable: boolean | null;
  lastPosition: string;
  mapsServiceReachable: boolean | null;
};

export async function collectLocationDiagnostics(): Promise<LocationDiagnostics> {
  let permission = 'unknown';
  let canAskAgain = false;
  let servicesEnabled: boolean | null = null;
  let gpsAvailable: boolean | null = null;
  let networkAvailable: boolean | null = null;
  let lastPosition = '无';
  let mapsServiceReachable: boolean | null = null;

  try {
    const result = await Location.getForegroundPermissionsAsync();
    permission = result.status;
    canAskAgain = result.canAskAgain;
  } catch {
    permission = '读取失败';
  }
  try {
    const provider = await Location.getProviderStatusAsync();
    servicesEnabled = provider.locationServicesEnabled;
    gpsAvailable = provider.gpsAvailable ?? null;
    networkAvailable = provider.networkAvailable ?? null;
  } catch {
    // Some platforms only expose permission information.
  }
  try {
    const position = await Location.getLastKnownPositionAsync();
    if (position) {
      const ageMinutes = Math.max(0, Math.round((Date.now() - position.timestamp) / 60_000));
      const accuracy = position.coords.accuracy == null ? '未知' : `${Math.round(position.coords.accuracy)} 米`;
      lastPosition = `${ageMinutes} 分钟前，精度 ${accuracy}`;
    }
  } catch {
    lastPosition = '读取失败';
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      await fetch('https://restapi.amap.com/v3/assistant/coordinate/convert', {
        method: 'GET',
        signal: controller.signal,
      });
      mapsServiceReachable = true;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    mapsServiceReachable = false;
  }

  return { permission, canAskAgain, servicesEnabled, gpsAvailable, networkAvailable, lastPosition, mapsServiceReachable };
}

function status(value: boolean | null) {
  return value === null ? '未知' : value ? '可用' : '不可用';
}

export function formatLocationDiagnostics(diagnostics: LocationDiagnostics) {
  return [
    `定位平台：${Platform.OS} ${String(Platform.Version)}`,
    `位置权限：${diagnostics.permission}（可再次询问：${diagnostics.canAskAgain ? '是' : '否'}）`,
    `系统定位：${status(diagnostics.servicesEnabled)}`,
    `GPS：${status(diagnostics.gpsAvailable)}`,
    `网络定位：${status(diagnostics.networkAvailable)}`,
    `高德地图服务：${status(diagnostics.mapsServiceReachable)}`,
    `最近坐标：${diagnostics.lastPosition}`,
  ].join('\n');
}
