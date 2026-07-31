import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { Circle, MapType, MapView, Marker, type MapViewRef } from 'expo-gaode-map';
import { router, useFocusEffect, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { AppDialog } from '@/components/app-dialog';
import { GaodeMapPrivacyGate } from '@/components/gaode-map-privacy-gate';
import { applyCoordinatesToLocation, getFootprintViewPreferences, listFootprintEntries, listLocationDuplicateSuggestions, listLocationMapPreferences, saveFootprintViewPreferences, type LocationMapPreference } from '@/database/journal-repository';
import type { FootprintEntry, PendingFootprintEntry, PendingLocationGroup } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { groupFootprintPlaces, groupFootprintRegions, initialFootprintCamera, type FootprintCluster } from '@/utils/footprint';
import { applyLocationPrivacy, type CoordinatePrivacyChoice } from '@/utils/location-privacy';
import { wgs84ToGcj02 } from '@/utils/china-coordinates';

function shortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(value));
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function FootprintMapScreen() {
  const db = useSQLiteContext();
  const { preferences, readingTheme, readingFontFamily } = useAppPreferences();
  const mapRef = useRef<MapViewRef>(null);
  const [entries, setEntries] = useState<FootprintEntry[]>([]);
  const [missingCoordinates, setMissingCoordinates] = useState(0);
  const [pendingEntries, setPendingEntries] = useState<PendingFootprintEntry[]>([]);
  const [pendingGroups, setPendingGroups] = useState<PendingLocationGroup[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const [pendingVisible, setPendingVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [rangePickerVisible, setRangePickerVisible] = useState(false);
  const [rangeEditorVisible, setRangeEditorVisible] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<FootprintCluster | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapTimedOut, setMapTimedOut] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeSort, setPlaceSort] = useState<'recent' | 'visits'>('recent');
  const [locationPreferences, setLocationPreferences] = useState<Record<string, LocationMapPreference>>({});
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [viewPreferencesLoaded, setViewPreferencesLoaded] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [backfillConfirmationVisible, setBackfillConfirmationVisible] = useState(false);
  const [backfillPrivacyVisible, setBackfillPrivacyVisible] = useState(false);

  const load = useCallback(async () => {
    const [result, preferences, viewPreferences, duplicates] = await Promise.all([
      listFootprintEntries(db),
      listLocationMapPreferences(db),
      getFootprintViewPreferences(db),
      listLocationDuplicateSuggestions(db),
    ]);
    setEntries(result.entries);
    setMissingCoordinates(result.missingCoordinates);
    setPendingEntries(result.pendingEntries);
    setPendingGroups(result.pendingGroups);
    setLocationPreferences(preferences);
    setDuplicateCount(duplicates.length);
    if (!viewPreferencesLoaded) {
      setPlaceSort(viewPreferences.sort);
      setViewPreferencesLoaded(true);
    }
    setLoading(false);
  }, [db, viewPreferencesLoaded]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!viewPreferencesLoaded) return;
    void saveFootprintViewPreferences(db, {
      viewMode,
      sort: placeSort,
      favoriteOnly: false,
      category: null,
    });
  }, [db, placeSort, viewMode, viewPreferencesLoaded]);

  const visibleEntries = useMemo(() => entries.filter((entry) => {
    const key = localDateKey(entry.occurredAt);
    if (customRange) return key >= customRange.start && key <= customRange.end;
    if (selectedMonth) return key.startsWith(selectedMonth);
    return selectedYear === null || new Date(entry.occurredAt).getFullYear() === selectedYear;
  }), [customRange, entries, selectedMonth, selectedYear]);
  const places = useMemo(() => groupFootprintPlaces(visibleEntries), [visibleEntries]);
  const regions = useMemo(() => groupFootprintRegions(places), [places]);
  const listPlaces = useMemo(() => places
    .filter((place) => !placeSearch.trim() || place.name.toLocaleLowerCase().includes(placeSearch.trim().toLocaleLowerCase()))
    .sort((a, b) => placeSort === 'visits'
      ? b.entries.length - a.entries.length
      : b.entries[0].occurredAt.localeCompare(a.entries[0].occurredAt)), [placeSearch, placeSort, places]);
  const initialCamera = useMemo(() => initialFootprintCamera(places), [places]);
  const amapCamera = useMemo(
    () => ({ ...wgs84ToGcj02({ latitude: initialCamera.latitude, longitude: initialCamera.longitude }), zoom: initialCamera.zoom }),
    [initialCamera],
  );
  const rangeLabel = useMemo(() => {
    if (customRange) return `${customRange.start.slice(5).replace('-', '.')}—${customRange.end.slice(5).replace('-', '.')}`;
    if (selectedMonth) return `${Number(selectedMonth.slice(5))} 月`;
    if (selectedYear) return `${selectedYear} 年`;
    return '全部时间';
  }, [customRange, selectedMonth, selectedYear]);
  const selectedRegionEntries = useMemo(() => selectedRegion
    ? selectedRegion.places.flatMap((place) => place.entries).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    : [], [selectedRegion]);
  useEffect(() => {
    if (mapReady || !places.length) return;
    const timer = setTimeout(() => setMapTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, [mapAttempt, mapReady, places.length]);

  const fitVisiblePlaces = useCallback(async (duration = 450) => {
    if (!mapRef.current || !places.length) return;
    const points = places.map((place) => wgs84ToGcj02({ latitude: place.latitude, longitude: place.longitude }));
    try {
      await mapRef.current.fitToCoordinates(points, {
        duration,
        paddingFactor: 0.14,
        paddingPx: 36,
        minZoom: 3,
        maxZoom: 14,
        singlePointZoom: 14,
      });
    } catch {
      await mapRef.current.moveCamera({
        target: { latitude: amapCamera.latitude, longitude: amapCamera.longitude },
        zoom: places.length === 1 ? 14 : initialCamera.zoom,
      }, duration);
    }
  }, [amapCamera.latitude, amapCamera.longitude, initialCamera.zoom, places]);

  useEffect(() => {
    if (!mapReady) return;
    void fitVisiblePlaces();
  }, [fitVisiblePlaces, mapReady]);

  function chooseYear(year: number | null) {
    setSelectedYear(year);
    setSelectedMonth(null);
    setCustomRange(null);
    setSelectedRegion(null);
    setRangePickerVisible(false);
  }

  function chooseMonth(month: string) {
    setSelectedYear(null);
    setSelectedMonth(month);
    setCustomRange(null);
    setSelectedRegion(null);
    setRangePickerVisible(false);
  }

  function applyCustomRange() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) || rangeStart > rangeEnd) {
      setNotice({ title: '日期范围不正确', message: '请输入 YYYY-MM-DD，并确保结束日期不早于开始日期。' });
      return;
    }
    setCustomRange({ start: rangeStart, end: rangeEnd });
    setSelectedMonth(null);
    setSelectedYear(null);
    setSelectedRegion(null);
    setRangeEditorVisible(false);
  }

  function resetCamera() {
    void fitVisiblePlaces();
  }

  function retryMap() {
    setMapReady(false);
    setMapTimedOut(false);
    setMapAttempt((value) => value + 1);
  }

  function chooseRegion(regionId: string) {
    const region = regions.find((item) => item.id === regionId);
    if (region) setSelectedRegion(region);
  }

  async function backfillPendingLocations(privacyOverride?: CoordinatePrivacyChoice) {
    if (backfilling || !pendingGroups.length) return;
    if (preferences.locationPrivacyMode === 'nameOnly') {
      setNotice({ title: '当前只保存地点名', message: '请先在“地点隐私与体检”中选择精确或模糊坐标，再为旧记录补点。' });
      return;
    }
    if (preferences.locationPrivacyMode === 'ask' && !privacyOverride) {
      setBackfillPrivacyVisible(true);
      return;
    }
    setBackfilling(true);
    try {
      const privacyChoice: CoordinatePrivacyChoice = privacyOverride ?? 'precise';
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setNotice({ title: '需要位置权限', message: 'Android 地址搜索需要位置权限。也可以逐条打开记录，在地图上手动选点。' });
        return;
      }
      let completed = 0;
      const failed: string[] = [];
      for (const group of pendingGroups) {
        try {
          const result = (await Location.geocodeAsync(group.locationName))[0];
          if (!result) failed.push(group.locationName);
          else {
            const privateCoordinates = applyLocationPrivacy(
              result.latitude, result.longitude, preferences.locationPrivacyMode, privacyChoice,
            );
            if (privateCoordinates.latitude == null || privateCoordinates.longitude == null) continue;
            await applyCoordinatesToLocation(db, group.locationName, privateCoordinates.latitude, privateCoordinates.longitude);
            completed += group.count;
          }
        } catch {
          failed.push(group.locationName);
        }
      }
      await load();
      setNotice({
        title: '补点完成',
        message: failed.length
          ? `已补全 ${completed} 条记录；${failed.length} 个名称无法确定，请逐条手动选点：${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`
          : `已为 ${completed} 条旧记录补全坐标。请检查地图位置，模糊名称建议手动修正。`,
      });
    } finally {
      setBackfilling(false);
    }
  }

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: readingTheme.background }]}><ActivityIndicator style={styles.loader} color={colors.primary} /></SafeAreaView>;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: readingTheme.background }]}>
    <View style={[styles.header, { borderBottomColor: readingTheme.border }]}>
      <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹ 返回</Text></Pressable>
      <Text style={[styles.title, { color: readingTheme.text }]}>足迹地图</Text>
      <Pressable hitSlop={12} onPress={() => setViewMode((value) => value === 'map' ? 'list' : 'map')} style={styles.headerAction}>
        <Text style={styles.headerActionText}>{viewMode === 'map' ? '地点列表' : '返回地图'}</Text>
      </Pressable>
    </View>

    <View style={styles.summary}>
      <View style={styles.summaryRow}>
        <Pressable onPress={() => setRangePickerVisible(true)} style={[styles.rangeButton, { backgroundColor: readingTheme.surface }]}>
          <Text style={styles.rangeButtonText}>{rangeLabel}</Text>
          <View style={styles.rangeButtonChevron} />
        </Pressable>
        <Text style={[styles.summaryText, { color: readingTheme.secondary }]}>{regions.length} 片足迹 · {visibleEntries.length} 段时光</Text>
      </View>
    </View>

    {viewMode === 'list' && places.length ? <View style={styles.listShell}>
      <TextInput value={placeSearch} onChangeText={setPlaceSearch} placeholder="搜索地点" placeholderTextColor={readingTheme.secondary} style={[styles.placeSearch, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.listFilterScroll} contentContainerStyle={styles.listFilters}>
        <Pressable onPress={() => setPlaceSort((value) => value === 'recent' ? 'visits' : 'recent')} style={[styles.listFilter, { backgroundColor: readingTheme.surface }]}><Text style={styles.listFilterText}>{placeSort === 'recent' ? '最近到访' : '到访最多'} ⇅</Text></Pressable>
      </ScrollView>
      {duplicateCount ? <Pressable onPress={() => router.push('/content-management' as Href)} style={[styles.duplicateNotice, { backgroundColor: readingTheme.surface }]}>
        <View style={styles.duplicateNoticeCopy}><Text style={styles.duplicateNoticeTitle}>发现 {duplicateCount} 组相近地点</Text><Text style={[styles.duplicateNoticeText, { color: readingTheme.secondary }]}>可能是同一地点，只在确认后才会合并</Text></View>
        <Text style={styles.duplicateNoticeArrow}>整理 ›</Text>
      </Pressable> : null}
      <ScrollView contentContainerStyle={styles.placeList} showsVerticalScrollIndicator={false}>
        {listPlaces.map((place) => {
          const preference = locationPreferences[place.name];
          return <Pressable key={place.id} onPress={() => router.push(`/location/${encodeURIComponent(place.name)}` as Href)} style={[styles.placeListRow, { backgroundColor: readingTheme.surface }]}>
            <View style={styles.placeListIcon}><Text style={styles.placeListLeaf}>{preference?.favorite ? '★' : '🍃'}</Text></View>
            <View style={styles.placeListCopy}><View style={styles.placeListNameRow}><Text numberOfLines={1} style={[styles.placeListName, { color: readingTheme.text }]}>{place.name}</Text></View><Text style={[styles.placeListMeta, { color: readingTheme.secondary }]}>{place.entries.length} 次到访 · 最近 {shortDate(place.entries[0].occurredAt)}</Text></View>
            <Text style={styles.placeListArrow}>›</Text>
          </Pressable>;
        })}
        {!listPlaces.length ? <Text style={[styles.noPlaces, { color: readingTheme.secondary }]}>没有符合条件的地点</Text> : null}
      </ScrollView>
    </View> : viewMode === 'map' && places.length ? <View style={styles.mapShell}>
      <GaodeMapPrivacyGate onDecline={() => setViewMode('list')}><MapView
        key={mapAttempt}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType={MapType.Standard}
        initialCameraPosition={{ target: { latitude: amapCamera.latitude, longitude: amapCamera.longitude }, zoom: initialCamera.zoom }}
        minZoom={3}
        maxZoom={17}
        compassEnabled={false}
        zoomControlsEnabled={false}
        myLocationButtonEnabled={false}
        rotateGesturesEnabled={false}
        scrollGesturesEnabled
        tiltGesturesEnabled={false}
        zoomGesturesEnabled
        onLoad={() => {
          setMapReady(true);
          setMapTimedOut(false);
        }}
        onMapPress={() => setSelectedRegion(null)}
      >
        {regions.map((region) => {
          const visits = region.places.reduce((total, place) => total + place.entries.length, 0);
          const glowStrength = Math.min(0.22, 0.11 + Math.log2(visits + 1) * 0.025);
          return <Circle
            key={`halo-${region.id}`}
            center={wgs84ToGcj02({ latitude: region.latitude, longitude: region.longitude })}
            radius={Math.min(360, 180 + Math.log2(visits + 1) * 32)}
            fillColor={selectedRegion?.id === region.id ? 'rgba(111, 156, 138, 0.25)' : `rgba(111, 156, 138, ${glowStrength})`}
            strokeColor={selectedRegion?.id === region.id ? 'rgba(79, 125, 107, 0.72)' : 'rgba(111, 156, 138, 0.34)'}
            strokeWidth={1}
            zIndex={Math.max(0, visits - 1)}
            onCirclePress={() => chooseRegion(region.id)}
          />;
        })}
        {regions.map((region) => {
          const moments = region.places.reduce((total, place) => total + place.entries.length, 0);
          const active = selectedRegion?.id === region.id;
          const leafSize = Math.min(28, 18 + Math.log2(moments + 1) * 2);
          return <Marker
            key={region.id}
            cacheKey={`footprint-region-${region.id}-${moments}-${active ? 'active' : 'idle'}`}
            position={wgs84ToGcj02({ latitude: region.latitude, longitude: region.longitude })}
            zIndex={moments}
            onMarkerPress={() => chooseRegion(region.id)}
          >
            <View style={[styles.memoryMarker, { width: leafSize + 8, height: leafSize + 8 }, active && styles.memoryMarkerActive]}>
              <View style={[styles.memoryLeaf, { width: leafSize * 1.18, height: leafSize * 0.72 }, active && styles.memoryLeafActive]}>
                <View style={styles.memoryLeafVein} />
              </View>
              <View style={styles.memoryLeafStem} />
            </View>
          </Marker>;
        })}
      </MapView></GaodeMapPrivacyGate>
      {!mapReady ? <View pointerEvents={mapTimedOut ? 'auto' : 'none'} style={styles.mapLoading}>
        {mapTimedOut ? <>
          <Text style={styles.mapLoadingTitle}>地图暂时没有加载出来</Text>
          <Text style={styles.mapLoadingText}>可以重新加载，或先使用地点列表查看已经保存的足迹。技术信息可在“关于拾时”中导出诊断。</Text>
          <View style={styles.mapFailureActions}>
            <Pressable onPress={retryMap} style={styles.retryButton}><Text style={styles.retryText}>重新加载</Text></Pressable>
            <Pressable onPress={() => setViewMode('list')} style={[styles.listFallbackButton, { backgroundColor: readingTheme.background }]}><Text style={styles.listFallbackText}>切换地点列表</Text></Pressable>
          </View>
        </> : <>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.mapLoadingText}>正在加载地图…</Text>
        </>}
      </View> : null}
      <Pressable accessibilityLabel="显示全部足迹" hitSlop={8} onPress={resetCamera} style={styles.resetButton}><Text style={styles.resetText}>全部足迹</Text></Pressable>
    </View> : !places.length ? <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}>
      <Text style={[styles.emptyTitle, { color: readingTheme.text }]}>还没有可点亮的地点</Text>
      <Text style={[styles.emptyText, { color: readingTheme.secondary }]}>记录时使用自动定位，保存坐标后就会出现在这里。</Text>
    </View> : null}

    {selectedRegion && selectedRegionEntries.length ? <View style={[styles.placeCard, { backgroundColor: readingTheme.background, borderColor: readingTheme.border }]}>
      <View style={styles.placeHeader}><View style={styles.placeHeading}><Text numberOfLines={1} style={[styles.placeName, { color: readingTheme.text }]}>{selectedRegion.places.length === 1 ? selectedRegion.places[0].name : '一片熟悉的地方'}</Text><Text style={[styles.placeMeta, { color: readingTheme.secondary }]}>{selectedRegion.places.length > 1 ? `${selectedRegion.places.length} 个地点 · ${selectedRegionEntries.length} 段时光` : `${selectedRegionEntries.length} 次到访 · 最近 ${shortDate(selectedRegionEntries[0].occurredAt)}`}</Text></View><Pressable hitSlop={10} onPress={() => setSelectedRegion(null)}><Text style={[styles.close, { color: readingTheme.secondary }]}>×</Text></Pressable></View>
      {selectedRegion.places.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionPlaces}>
        {selectedRegion.places.slice(0, 5).map((place) => <Pressable key={place.id} hitSlop={6} onPress={() => router.push(`/location/${encodeURIComponent(place.name)}` as Href)} style={[styles.regionPlace, { backgroundColor: readingTheme.surface }]}><Text numberOfLines={1} style={styles.regionPlaceText}>{place.name}</Text></Pressable>)}
      </ScrollView> : null}
      <Pressable onPress={() => router.push({ pathname: '/entry/[id]', params: { id: selectedRegionEntries[0].id } })} style={[styles.latestEntry, { backgroundColor: readingTheme.surface }]}>
        <Text style={styles.entryDate}>最近一次 · {shortDate(selectedRegionEntries[0].occurredAt)}</Text>
        <Text numberOfLines={1} style={[styles.latestEntryText, { color: readingTheme.text, fontFamily: readingFontFamily }]}>{selectedRegionEntries[0].content || '一段没有文字的时光'}</Text>
      </Pressable>
      {selectedRegion.places.length === 1 ? <Pressable onPress={() => router.push(`/location/${encodeURIComponent(selectedRegion.places[0].name)}` as Href)} style={styles.placeDetailButton}><Text style={styles.placeDetailText}>查看这里的记录 ›</Text></Pressable> : null}
    </View> : null}

    {viewMode === 'list' && missingCoordinates && !selectedRegion ? <View style={styles.pendingArea}>
      <Pressable
        accessibilityState={{ expanded: pendingVisible }}
        onPress={() => setPendingVisible((value) => !value)}
        style={[styles.pendingToggle, { backgroundColor: readingTheme.surface }]}
      >
        <View style={styles.pendingHeading}><Text style={styles.pendingTitle}>{missingCoordinates} 条记录等待点亮</Text><Text style={[styles.pendingHint, { color: readingTheme.secondary }]}>已有地点名称，但还缺少地图坐标</Text></View>
        <Pressable disabled={backfilling} onPress={(event) => { event.stopPropagation(); setBackfillConfirmationVisible(true); }} style={styles.backfillButton}><Text style={styles.backfillText}>{backfilling ? '补全中…' : '智能补点'}</Text></Pressable>
        <View style={[styles.pendingChevron, pendingVisible && styles.pendingChevronOpen]} />
      </Pressable>
      {pendingVisible ? <View style={[styles.pendingList, { backgroundColor: readingTheme.background, borderColor: readingTheme.border }]}>
        {pendingEntries.map((entry) => <Pressable
          key={entry.id}
          onPress={() => router.push({ pathname: '/compose', params: { id: entry.id } })}
          style={[styles.pendingRow, { borderBottomColor: readingTheme.border }]}
        >
          <View style={styles.pendingCopy}>
            <Text numberOfLines={1} style={[styles.pendingLocation, { color: readingTheme.text }]}>⌖ {entry.locationName}</Text>
            <Text numberOfLines={1} style={[styles.pendingContent, { color: readingTheme.secondary }]}>{entry.content || shortDate(entry.occurredAt)}</Text>
          </View>
          <Text style={styles.pendingAction}>去定位 ›</Text>
        </Pressable>)}
        {missingCoordinates > pendingEntries.length ? <Text style={[styles.pendingMore, { color: readingTheme.secondary }]}>先显示最近 {pendingEntries.length} 条</Text> : null}
      </View> : null}
    </View> : null}
    <Modal visible={rangePickerVisible} transparent animationType="fade" onRequestClose={() => setRangePickerVisible(false)}>
      <Pressable onPress={() => setRangePickerVisible(false)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.rangePicker, { backgroundColor: readingTheme.background }]}>
        <Text style={[styles.rangeTitle, { color: readingTheme.text }]}>查看哪段时光？</Text>
        <View style={styles.rangeChoices}>
          <Pressable onPress={() => chooseYear(null)} style={[styles.rangeChoice, !selectedYear && !selectedMonth && !customRange && styles.rangeChoiceActive, { borderBottomColor: readingTheme.border }]}><Text style={[styles.rangeChoiceText, { color: readingTheme.text }]}>全部时间</Text><Text style={styles.rangeChoiceMark}>{!selectedYear && !selectedMonth && !customRange ? '✓' : ''}</Text></Pressable>
          <Pressable onPress={() => chooseYear(new Date().getFullYear())} style={[styles.rangeChoice, selectedYear === new Date().getFullYear() && styles.rangeChoiceActive, { borderBottomColor: readingTheme.border }]}><Text style={[styles.rangeChoiceText, { color: readingTheme.text }]}>今年</Text><Text style={styles.rangeChoiceMark}>{selectedYear === new Date().getFullYear() ? '✓' : ''}</Text></Pressable>
          <Pressable onPress={() => chooseMonth(localDateKey(new Date().toISOString()).slice(0, 7))} style={[styles.rangeChoice, selectedMonth === localDateKey(new Date().toISOString()).slice(0, 7) && styles.rangeChoiceActive, { borderBottomColor: readingTheme.border }]}><Text style={[styles.rangeChoiceText, { color: readingTheme.text }]}>本月</Text><Text style={styles.rangeChoiceMark}>{selectedMonth === localDateKey(new Date().toISOString()).slice(0, 7) ? '✓' : ''}</Text></Pressable>
          <Pressable onPress={() => { setRangePickerVisible(false); setRangeStart(customRange?.start ?? ''); setRangeEnd(customRange?.end ?? ''); setRangeEditorVisible(true); }} style={[styles.rangeChoice, styles.rangeChoiceLast]}><Text style={[styles.rangeChoiceText, { color: readingTheme.text }]}>自定义日期</Text><View style={styles.rangeChoiceChevron} /></Pressable>
        </View>
      </Pressable></Pressable>
    </Modal>
    <Modal visible={rangeEditorVisible} transparent animationType="fade" onRequestClose={() => setRangeEditorVisible(false)}>
      <Pressable onPress={() => setRangeEditorVisible(false)} style={styles.overlay}><Pressable onPress={(event) => event.stopPropagation()} style={[styles.rangeEditor, { backgroundColor: readingTheme.background }]}>
        <Text style={[styles.rangeTitle, { color: readingTheme.text }]}>自定义足迹时间</Text>
        <Text style={[styles.rangeHint, { color: readingTheme.secondary }]}>输入开始与结束日期</Text>
        <View style={styles.rangeInputs}><TextInput value={rangeStart} onChangeText={setRangeStart} placeholder="2026-01-01" placeholderTextColor={readingTheme.secondary} style={[styles.rangeInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /><Text style={[styles.rangeDash, { color: readingTheme.secondary }]}>至</Text><TextInput value={rangeEnd} onChangeText={setRangeEnd} placeholder="2026-12-31" placeholderTextColor={readingTheme.secondary} style={[styles.rangeInput, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} /></View>
        <View style={styles.rangeActions}><Pressable onPress={() => { setCustomRange(null); setRangeEditorVisible(false); }}><Text style={[styles.rangeCancel, { color: readingTheme.secondary }]}>清除</Text></Pressable><Pressable onPress={applyCustomRange}><Text style={styles.rangeSave}>查看足迹</Text></Pressable></View>
      </Pressable></Pressable>
    </Modal>
    <AppDialog visible={Boolean(notice)} title={notice?.title ?? ''} message={notice?.message} onClose={() => setNotice(null)} actions={[{ label: '知道了', tone: 'primary', onPress: () => setNotice(null) }]} />
    <AppDialog visible={backfillConfirmationVisible} title="智能补全旧地点？" message={`将搜索 ${pendingGroups.length} 个地点名称，并把结果应用到同名记录。像“家”“学校”这样的名称可能不准确，之后可以逐条修正。`} onClose={() => setBackfillConfirmationVisible(false)} actions={[{ label: '取消', onPress: () => setBackfillConfirmationVisible(false) }, { label: '开始补全', tone: 'primary', onPress: () => { setBackfillConfirmationVisible(false); void backfillPendingLocations(); } }]} />
    <AppDialog visible={backfillPrivacyVisible} title="怎样保存补全的坐标？" message="本次补点会对所有待处理地点使用同一种精度。" onClose={() => setBackfillPrivacyVisible(false)} actions={[{ label: '取消', onPress: () => setBackfillPrivacyVisible(false) }, { label: '约 1 公里', onPress: () => { setBackfillPrivacyVisible(false); void backfillPendingLocations('approximate'); } }, { label: '精确坐标', tone: 'primary', onPress: () => { setBackfillPrivacyVisible(false); void backfillPendingLocations('precise'); } }]} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, loader: { marginTop: 100 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' },
  headerAction: { minWidth: 52, minHeight: 36, alignItems: 'flex-end', justifyContent: 'center' }, headerActionText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  summary: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  summaryRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rangeButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.pill },
  rangeButtonText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  rangeButtonChevron: { width: 6, height: 6, marginTop: -3, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] },
  summaryText: { flexShrink: 1, fontSize: 11, textAlign: 'right' },
  mapShell: { flex: 1, overflow: 'hidden', marginHorizontal: spacing.md, borderRadius: radii.lg, backgroundColor: colors.primarySoft },
  listShell: { flex: 1 }, placeSearch: { height: 42, marginHorizontal: spacing.xl, paddingHorizontal: spacing.md, borderRadius: radii.pill, fontSize: 11 },
  listFilterScroll: { flexGrow: 0, height: 40 }, listFilters: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: 4 }, listFilter: { minHeight: 30, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, listFilterText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  duplicateNotice: { minHeight: 50, flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md },
  duplicateNoticeCopy: { flex: 1, minWidth: 0 }, duplicateNoticeTitle: { color: colors.primary, fontSize: 11, fontWeight: '700' }, duplicateNoticeText: { marginTop: 2, fontSize: 10 }, duplicateNoticeArrow: { marginLeft: spacing.sm, color: colors.primary, fontSize: 10, fontWeight: '700' },
  placeList: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl }, placeListRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.md },
  placeListIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primarySoft }, placeListLeaf: { color: colors.primary, fontSize: 17 },
  placeListCopy: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md }, placeListNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, placeListName: { flexShrink: 1, fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  placeListMeta: { marginTop: 4, fontSize: 11 }, placeListArrow: { color: colors.primary, fontSize: 18 }, noPlaces: { paddingTop: spacing.xxl, textAlign: 'center', fontSize: 12 },
  mapLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, backgroundColor: colors.primarySoft },
  mapLoadingTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, textAlign: 'center' },
  mapLoadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  mapFailureActions: { width: '100%', maxWidth: 250, gap: spacing.sm, marginTop: spacing.lg },
  retryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  listFallbackButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, listFallbackText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  memoryMarker: { alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#FFFFFFB8', elevation: 2 },
  memoryMarkerActive: { backgroundColor: '#FFFFFFF2', elevation: 4 },
  memoryLeaf: { overflow: 'hidden', borderTopLeftRadius: 3, borderTopRightRadius: 24, borderBottomRightRadius: 3, borderBottomLeftRadius: 24, backgroundColor: '#7FA593', transform: [{ rotate: '-28deg' }] },
  memoryLeafActive: { backgroundColor: colors.primary, transform: [{ rotate: '-28deg' }, { scale: 1.08 }] },
  memoryLeafVein: { position: 'absolute', left: '15%', top: '46%', width: '70%', height: 1.25, borderRadius: 1, backgroundColor: '#DDEBE5CC' },
  memoryLeafStem: { position: 'absolute', left: '18%', bottom: '17%', width: 7, height: 1.5, borderRadius: 1, backgroundColor: '#7FA593', transform: [{ rotate: '-28deg' }] },
  resetButton: { position: 'absolute', right: spacing.md, bottom: spacing.md, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: '#FFFFFFEE', elevation: 3, shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } }, resetText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', margin: spacing.xl, padding: spacing.xxl, borderRadius: radii.lg }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18 }, emptyText: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  placeCard: { marginHorizontal: spacing.md, marginTop: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg }, placeHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: spacing.xs }, placeHeading: { flex: 1, paddingRight: spacing.md }, placeName: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '600' }, placeMeta: { marginTop: 2, fontSize: 10 }, close: { minWidth: 36, minHeight: 36, paddingLeft: spacing.md, fontSize: 20, lineHeight: 36 },
  regionPlaces: { gap: spacing.xs, paddingBottom: spacing.xs }, regionPlace: { maxWidth: 145, minHeight: 26, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, regionPlaceText: { color: colors.primary, fontSize: 9, fontWeight: '600' },
  latestEntry: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md }, entryDate: { color: colors.primary, fontSize: 10, fontWeight: '700' }, latestEntryText: { marginTop: 3, fontSize: 11, lineHeight: 17 },
  placeDetailButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center' }, placeDetailText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  pendingArea: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  pendingToggle: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md },
  pendingHeading: { flex: 1, minWidth: 0 },
  pendingTitle: { color: colors.primary, fontSize: 12, fontWeight: '700' }, pendingHint: { marginTop: 2, fontSize: 11 },
  backfillButton: { minHeight: 36, justifyContent: 'center', marginLeft: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, backfillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  pendingChevron: { width: 7, height: 7, marginLeft: spacing.sm, marginTop: -3, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '45deg' }] },
  pendingChevronOpen: { marginTop: 4, transform: [{ rotate: '-135deg' }] },
  pendingList: { marginTop: spacing.xs, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  pendingRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  pendingCopy: { flex: 1, paddingRight: spacing.md }, pendingLocation: { fontSize: 12, fontWeight: '600' }, pendingContent: { marginTop: 2, fontSize: 11 },
  pendingAction: { color: colors.primary, fontSize: 11, fontWeight: '700' }, pendingMore: { paddingVertical: spacing.md, fontSize: 11, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: '#00000055' }, rangePicker: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.sm, borderRadius: radii.lg }, rangeEditor: { padding: spacing.xl, borderRadius: radii.lg },
  rangeTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, rangeHint: { marginTop: spacing.xs, fontSize: 11 },
  rangeChoices: { marginTop: spacing.md }, rangeChoice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, rangeChoiceLast: { borderBottomWidth: 0 }, rangeChoiceActive: { opacity: 1 }, rangeChoiceText: { fontSize: 13 }, rangeChoiceMark: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  rangeChoiceChevron: { width: 7, height: 7, marginRight: 3, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.primary, transform: [{ rotate: '-45deg' }] },
  rangeInputs: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }, rangeInput: { flex: 1, height: 44, paddingHorizontal: spacing.sm, borderRadius: radii.md, fontSize: 12 }, rangeDash: { fontSize: 11 },
  rangeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xl, marginTop: spacing.xl }, rangeCancel: { fontSize: 11 }, rangeSave: { color: colors.primary, fontSize: 11, fontWeight: '700' },
});
