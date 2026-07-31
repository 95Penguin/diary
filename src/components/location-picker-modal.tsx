import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MapType, MapView, reGeocode, searchPOI, type MapViewRef, type POI } from 'expo-gaode-map';

import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { gcj02ToWgs84, wgs84ToGcj02 } from '@/utils/china-coordinates';
import { rankNearbyPois } from '@/utils/location-poi';
import { GaodeMapPrivacyGate } from '@/components/gaode-map-privacy-gate';

type Coordinate = { latitude: number; longitude: number };

function fullPoiAddress(poi: POI) {
  const candidates = [poi.provinceName, poi.cityName, poi.adName, poi.address]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const parts: string[] = [];
  for (const candidate of candidates) {
    if (parts.some((part) => part === candidate || part.includes(candidate))) continue;
    const containedIndex = parts.findIndex((part) => candidate.includes(part));
    if (containedIndex >= 0) parts[containedIndex] = candidate;
    else parts.push(candidate);
  }
  return parts.join('') || poi.name;
}

export function LocationPickerModal({ visible, name, latitude, longitude, accuracy, onClose, onApply }: {
  visible: boolean;
  name: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  onClose: () => void;
  onApply: (value: { name: string; address: string; latitude: number; longitude: number }) => void;
}) {
  const { readingTheme } = useAppPreferences();
  const mapRef = useRef<MapViewRef>(null);
  const initialWgs84 = latitude != null && longitude != null ? { latitude, longitude } : { latitude: 39.9042, longitude: 116.4074 };
  const initial = wgs84ToGcj02(initialWgs84);
  const [coordinate, setCoordinate] = useState<Coordinate>(initial);
  const [displayName, setDisplayName] = useState(name);
  const [resolvedAddress, setResolvedAddress] = useState(name);
  const [query, setQuery] = useState(name);
  const [latitudeText, setLatitudeText] = useState(String(initial.latitude));
  const [longitudeText, setLongitudeText] = useState(String(initial.longitude));
  const [searching, setSearching] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapTimedOut, setMapTimedOut] = useState(false);
  const [poiResults, setPoiResults] = useState<POI[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setMapTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  function moveTo(next: Coordinate, nextName?: string) {
    setCoordinate(next);
    setLatitudeText(next.latitude.toFixed(6));
    setLongitudeText(next.longitude.toFixed(6));
    if (nextName) setDisplayName(nextName);
    void mapRef.current?.moveCamera({ target: next, zoom: 16 }, 350);
  }

  function choosePoi(result: POI) {
    setResolvedAddress(fullPoiAddress(result));
    setDisplayName(result.name);
    setQuery(result.name);
    moveTo(result.location);
  }

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setMessage('');
    try {
      const results = await searchPOI({ keyword: query.trim(), center: coordinate, sortByDistance: true, pageSize: 10, pageNum: 1 });
      const ranked = rankNearbyPois(results.pois, query);
      const result = ranked[0];
      if (!result) {
        setPoiResults([]);
        setMessage('没有找到这个地点，可以输入更完整的地址或直接填写坐标。');
        return;
      }
      setPoiResults(ranked.slice(0, 8));
      choosePoi(result);
    } catch {
      setMessage('地点搜索暂时不可用，可以在地图上点选或直接填写坐标。');
    } finally {
      setSearching(false);
    }
  }

  async function choose(next: Coordinate) {
    moveTo(next);
    try {
      const result = await reGeocode({ location: next, radius: 200 });
      const ranked = rankNearbyPois(result.pois);
      setPoiResults(ranked.slice(0, 8));
      const resolved = ranked[0]?.name || result.formattedAddress;
      if (resolved) {
        setResolvedAddress(result.formattedAddress || resolved);
        setDisplayName(resolved);
        setQuery(resolved);
      }
    } catch {
      // Coordinates remain usable when reverse geocoding is unavailable.
    }
  }

  function applyCoordinateText() {
    const nextLatitude = Number(latitudeText);
    const nextLongitude = Number(longitudeText);
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude) || Math.abs(nextLatitude) > 90 || Math.abs(nextLongitude) > 180) {
      setMessage('请输入有效坐标：纬度 -90～90，经度 -180～180。');
      return;
    }
    moveTo({ latitude: nextLatitude, longitude: nextLongitude });
    setMessage('');
  }

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={[styles.safe, { backgroundColor: readingTheme.background }]}>
      <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
        <Pressable hitSlop={12} onPress={onClose}><Text style={[styles.headerAction, { color: readingTheme.secondary }]}>取消</Text></Pressable>
        <Text style={[styles.title, { color: readingTheme.text }]}>选择地点</Text>
        <Pressable onPress={() => {
          const storedCoordinate = gcj02ToWgs84(coordinate);
          onApply({ name: displayName.trim() || query.trim() || `${storedCoordinate.latitude.toFixed(5)}, ${storedCoordinate.longitude.toFixed(5)}`, address: resolvedAddress.trim() || query.trim(), ...storedCoordinate });
        }}><Text style={styles.apply}>使用此位置</Text></Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} returnKeyType="search" placeholder="搜索学校、街道或景点" placeholderTextColor={readingTheme.secondary} style={[styles.searchInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
        <Pressable disabled={!query.trim() || searching} onPress={() => void search()} style={styles.searchButton}><Text style={styles.searchButtonText}>{searching ? '搜索中' : '搜索'}</Text></Pressable>
      </View>

      <View style={[styles.mapShell, { backgroundColor: readingTheme.surface }]}>
        {Platform.OS === 'android' ? <GaodeMapPrivacyGate onDecline={onClose}><MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapType={MapType.Standard}
          initialCameraPosition={{ target: coordinate, zoom: latitude != null ? 16 : 10 }}
          myLocationButtonEnabled={false}
          rotateGesturesEnabled={false}
          tiltGesturesEnabled={false}
          zoomControlsEnabled={false}
          onLoad={() => { setMapReady(true); setMapTimedOut(false); }}
          onMapPress={(event) => {
            const coordinate = event?.nativeEvent;
            if (!coordinate || coordinate.latitude == null || coordinate.longitude == null) return;
            void choose(coordinate);
          }}
          onMapLongPress={(event) => {
            const coordinate = event?.nativeEvent;
            if (!coordinate || coordinate.latitude == null || coordinate.longitude == null) return;
            void choose(coordinate);
          }}
          onCameraIdle={(event) => {
            const target = event?.nativeEvent?.cameraPosition?.target;
            if (!target || !Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) return;
            setCoordinate(target);
            setLatitudeText(target.latitude.toFixed(6));
            setLongitudeText(target.longitude.toFixed(6));
          }}
        /></GaodeMapPrivacyGate> : null}
        {mapReady ? <View pointerEvents="none" style={styles.centerPin}><Text style={styles.centerPinText}>⌖</Text></View> : null}
        {!mapReady ? <View pointerEvents="none" style={styles.mapFallback}>
          {!mapTimedOut && Platform.OS === 'android' ? <ActivityIndicator color={colors.primary} /> : null}
          <Text style={[styles.mapHint, { color: readingTheme.secondary }]}>{mapTimedOut ? '地图不可用，仍可搜索或填写坐标' : Platform.OS === 'android' ? '正在加载地图…' : '当前平台请使用搜索或坐标选点'}</Text>
        </View> : null}
      </View>
      <View style={styles.tipRow}>
        <Text style={[styles.tip, { color: readingTheme.secondary }]}>拖动中心图钉后，可识别附近建筑。</Text>
        <Pressable hitSlop={8} onPress={() => void choose(coordinate)} style={[styles.nearbyButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.nearbyButtonText}>识别附近地点</Text></Pressable>
      </View>
      {poiResults.length ? <View style={styles.poiArea}>
        <Text style={[styles.poiLabel, { color: readingTheme.secondary }]}>附近地点</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poiList}>
          {poiResults.map((poi) => <Pressable key={poi.id} onPress={() => choosePoi(poi)} style={[styles.poiChip, { backgroundColor: poi.name === displayName ? colors.primary : readingTheme.surface }]}>
            <Text numberOfLines={1} style={[styles.poiName, { color: poi.name === displayName ? '#FFFFFF' : colors.primary }]}>{poi.name}</Text>
            {poi.distance != null ? <Text style={[styles.poiDistance, { color: poi.name === displayName ? '#FFFFFFCC' : readingTheme.secondary }]}>{Math.round(poi.distance)} 米</Text> : null}
          </Pressable>)}
        </ScrollView>
      </View> : null}

      <View style={styles.coordinateRow}>
        <TextInput keyboardType="numbers-and-punctuation" value={latitudeText} onChangeText={setLatitudeText} placeholder="纬度" placeholderTextColor={readingTheme.secondary} style={[styles.coordinateInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
        <TextInput keyboardType="numbers-and-punctuation" value={longitudeText} onChangeText={setLongitudeText} placeholder="经度" placeholderTextColor={readingTheme.secondary} style={[styles.coordinateInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
        <Pressable onPress={applyCoordinateText} style={[styles.coordinateButton, { backgroundColor: readingTheme.surface }]}><Text style={styles.coordinateButtonText}>定位</Text></Pressable>
      </View>
      <TextInput value={displayName} onChangeText={setDisplayName} maxLength={100} placeholder="显示名称，例如：学校" placeholderTextColor={readingTheme.secondary} style={[styles.nameInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
      {resolvedAddress && resolvedAddress !== displayName ? <Text numberOfLines={2} style={[styles.resolvedAddress, { color: readingTheme.secondary }]}>详细地址：{resolvedAddress}</Text> : null}
      {accuracy != null ? <Text style={[styles.accuracy, { color: readingTheme.secondary }]}>自动定位精度约 ±{Math.max(1, Math.round(accuracy))} 米；手动调整后仅代表所选图钉位置。</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingTop: Platform.OS === 'android' ? 28 : 48 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  headerAction: { minWidth: 64, fontSize: 12 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, apply: { minWidth: 64, color: colors.primary, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  searchInput: { flex: 1, height: 36, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 11 },
  searchButton: { minWidth: 54, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.primary }, searchButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  mapShell: { flex: 1, overflow: 'hidden', marginHorizontal: spacing.md, borderRadius: radii.lg },
  centerPin: { position: 'absolute', top: '50%', left: '50%', width: 32, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -16, marginTop: -32 }, centerPinText: { color: colors.primary, fontSize: 32, lineHeight: 38 },
  mapFallback: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, mapHint: { fontSize: 10 },
  tipRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, tip: { flexShrink: 1, color: colors.textSecondary, fontSize: 10, textAlign: 'center' }, nearbyButton: { minHeight: 26, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, nearbyButtonText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  poiArea: { paddingBottom: spacing.xs }, poiLabel: { paddingHorizontal: spacing.md, paddingBottom: 3, fontSize: 10 }, poiList: { gap: spacing.xs, paddingHorizontal: spacing.md }, poiChip: { maxWidth: 150, minHeight: 30, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, poiName: { fontSize: 10, fontWeight: '600' }, poiDistance: { marginTop: 1, fontSize: 9 },
  coordinateRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md },
  coordinateInput: { flex: 1, height: 36, paddingHorizontal: spacing.sm, borderRadius: radii.md, fontSize: 10 },
  coordinateButton: { height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md }, coordinateButtonText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  nameInput: { height: 38, marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderRadius: radii.md, fontSize: 11 },
  resolvedAddress: { marginHorizontal: spacing.lg, marginTop: -spacing.xs, marginBottom: spacing.sm, fontSize: 10, lineHeight: 16 },
  accuracy: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  message: { marginHorizontal: spacing.lg, marginBottom: spacing.md, color: colors.danger, fontSize: 10, lineHeight: 16, textAlign: 'center' },
});
