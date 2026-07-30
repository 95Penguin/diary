import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { MapType, MapView, Marker, type MapViewRef } from 'expo-gaode-map';
import { router, useFocusEffect, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { AppDialog } from '@/components/app-dialog';
import { GaodeMapPrivacyGate } from '@/components/gaode-map-privacy-gate';
import { applyCoordinatesToLocation, getFootprintViewPreferences, listFootprintEntries, listLocationMapPreferences, saveFootprintViewPreferences, type LocationCategory, type LocationMapPreference } from '@/database/journal-repository';
import type { FootprintEntry, PendingFootprintEntry, PendingLocationGroup } from '@/domain/journal';
import { useAppPreferences } from '@/preferences/app-preferences';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { clusterFootprintPlaces, groupFootprintPlaces, initialFootprintCamera, summarizeFootprintPlace, type FootprintPlace } from '@/utils/footprint';
import { applyLocationPrivacy, type CoordinatePrivacyChoice } from '@/utils/location-privacy';
import { wgs84ToGcj02 } from '@/utils/china-coordinates';

function shortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(value));
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function zoomBand(zoom: number) {
  return zoom < 5 ? 4 : zoom < 8 ? 7 : zoom < 11 ? 10 : 14;
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
  const [rangeEditorVisible, setRangeEditorVisible] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [illuminatedPlace, setIlluminatedPlace] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<FootprintPlace | null>(null);
  const [currentZoomBand, setCurrentZoomBand] = useState(7);
  const [mapReady, setMapReady] = useState(false);
  const [mapTimedOut, setMapTimedOut] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeSort, setPlaceSort] = useState<'recent' | 'visits'>('recent');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<LocationCategory | null>(null);
  const [locationPreferences, setLocationPreferences] = useState<Record<string, LocationMapPreference>>({});
  const [viewPreferencesLoaded, setViewPreferencesLoaded] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [backfillConfirmationVisible, setBackfillConfirmationVisible] = useState(false);
  const [backfillPrivacyVisible, setBackfillPrivacyVisible] = useState(false);

  const load = useCallback(async () => {
    const [result, preferences, viewPreferences] = await Promise.all([listFootprintEntries(db), listLocationMapPreferences(db), getFootprintViewPreferences(db)]);
    setEntries(result.entries);
    setMissingCoordinates(result.missingCoordinates);
    setPendingEntries(result.pendingEntries);
    setPendingGroups(result.pendingGroups);
    setLocationPreferences(preferences);
    if (!viewPreferencesLoaded) {
      setViewMode(viewPreferences.viewMode);
      setPlaceSort(viewPreferences.sort);
      setFavoriteOnly(viewPreferences.favoriteOnly);
      setCategoryFilter(viewPreferences.category);
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
      favoriteOnly,
      category: categoryFilter,
    });
  }, [categoryFilter, db, favoriteOnly, placeSort, viewMode, viewPreferencesLoaded]);

  const years = useMemo(() => [...new Set(entries.map((entry) => new Date(entry.occurredAt).getFullYear()))].sort((a, b) => b - a), [entries]);
  const months = useMemo(() => [...new Set(entries
    .filter((entry) => selectedYear === null || new Date(entry.occurredAt).getFullYear() === selectedYear)
    .map((entry) => localDateKey(entry.occurredAt).slice(0, 7)))].sort().reverse(), [entries, selectedYear]);
  const visibleEntries = useMemo(() => entries.filter((entry) => {
    const key = localDateKey(entry.occurredAt);
    if (customRange) return key >= customRange.start && key <= customRange.end;
    if (selectedMonth) return key.startsWith(selectedMonth);
    return selectedYear === null || new Date(entry.occurredAt).getFullYear() === selectedYear;
  }), [customRange, entries, selectedMonth, selectedYear]);
  const places = useMemo(() => groupFootprintPlaces(visibleEntries), [visibleEntries]);
  const listPlaces = useMemo(() => places
    .filter((place) => !placeSearch.trim() || place.name.toLocaleLowerCase().includes(placeSearch.trim().toLocaleLowerCase()))
    .filter((place) => !favoriteOnly || locationPreferences[place.name]?.favorite)
    .filter((place) => !categoryFilter || locationPreferences[place.name]?.category === categoryFilter)
    .sort((a, b) => placeSort === 'visits'
      ? b.entries.length - a.entries.length
      : b.entries[0].occurredAt.localeCompare(a.entries[0].occurredAt)), [categoryFilter, favoriteOnly, locationPreferences, placeSearch, placeSort, places]);
  const clusters = useMemo(() => clusterFootprintPlaces(places, currentZoomBand), [currentZoomBand, places]);
  const initialCamera = useMemo(() => initialFootprintCamera(places), [places]);
  const amapCamera = useMemo(
    () => ({ ...wgs84ToGcj02({ latitude: initialCamera.latitude, longitude: initialCamera.longitude }), zoom: initialCamera.zoom }),
    [initialCamera],
  );
  const selectedSummary = useMemo(() => selectedPlace ? summarizeFootprintPlace(selectedPlace) : null, [selectedPlace]);
  const footprintStory = useMemo(() => {
    if (!visibleEntries.length) return '';
    const ranked = groupFootprintPlaces(visibleEntries).sort((a, b) => b.entries.length - a.entries.length);
    const visibleIds = new Set(visibleEntries.map((entry) => entry.id));
    const earliestVisible = [...visibleEntries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0].occurredAt;
    const earlierNames = new Set(entries.filter((entry) => !visibleIds.has(entry.id) && entry.occurredAt < earliestVisible).map((entry) => entry.locationName));
    const newPlaces = ranked.filter((place) => !earlierNames.has(place.name)).length;
    return `${newPlaces ? `点亮了 ${newPlaces} 个新地点，` : ''}最常留下时光的是“${ranked[0].name}”，共到访 ${ranked[0].entries.length} 次。`;
  }, [entries, visibleEntries]);
  useEffect(() => {
    if (mapReady || !places.length) return;
    const timer = setTimeout(() => setMapTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, [mapAttempt, mapReady, places.length]);

  useEffect(() => {
    if (!mapReady) return;
    void mapRef.current?.moveCamera({
      target: { latitude: amapCamera.latitude, longitude: amapCamera.longitude },
      zoom: initialCamera.zoom,
    }, 450);
  }, [amapCamera.latitude, amapCamera.longitude, initialCamera.zoom, mapReady, selectedYear]);

  function chooseYear(year: number | null) {
    setSelectedYear(year);
    setSelectedMonth(null);
    setCustomRange(null);
    setSelectedPlace(null);
    const nextEntries = year === null
      ? entries
      : entries.filter((entry) => new Date(entry.occurredAt).getFullYear() === year);
    setCurrentZoomBand(zoomBand(initialFootprintCamera(groupFootprintPlaces(nextEntries)).zoom));
  }

  function chooseMonth(month: string) {
    setSelectedMonth(month);
    setCustomRange(null);
    setSelectedPlace(null);
  }

  function applyCustomRange() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) || rangeStart > rangeEnd) {
      setNotice({ title: '日期范围不正确', message: '请输入 YYYY-MM-DD，并确保结束日期不早于开始日期。' });
      return;
    }
    setCustomRange({ start: rangeStart, end: rangeEnd });
    setSelectedMonth(null);
    setSelectedYear(null);
    setSelectedPlace(null);
    setRangeEditorVisible(false);
  }

  function resetCamera() {
    void mapRef.current?.moveCamera({
      target: { latitude: amapCamera.latitude, longitude: amapCamera.longitude },
      zoom: initialCamera.zoom,
    }, 450);
  }

  function retryMap() {
    setMapReady(false);
    setMapTimedOut(false);
    setMapAttempt((value) => value + 1);
  }

  function chooseMarker(clusterId: string) {
    const cluster = clusters.find((item) => item.id === clusterId);
    if (!cluster) return;
    if (cluster.places.length > 1) {
      void mapRef.current?.moveCamera({
        target: wgs84ToGcj02({ latitude: cluster.latitude, longitude: cluster.longitude }),
        zoom: Math.min(15, currentZoomBand + 3),
      }, 420);
      return;
    }
    setSelectedPlace(cluster.places[0]);
    if (cluster.places[0].entries.length === 1) {
      setIlluminatedPlace(cluster.places[0].name);
      setTimeout(() => setIlluminatedPlace(null), 2200);
    }
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
      <View style={styles.headerSpace} />
    </View>

    <View style={styles.summary}>
      <View style={styles.primaryFilters}>
        <View style={[styles.viewSwitch, { backgroundColor: readingTheme.surface }]}>
          <Pressable onPress={() => setViewMode('map')} style={[styles.viewOption, viewMode === 'map' && styles.viewOptionActive]}><Text style={[styles.viewOptionText, viewMode === 'map' && styles.viewOptionTextActive]}>地图</Text></Pressable>
          <Pressable onPress={() => setViewMode('list')} style={[styles.viewOption, viewMode === 'list' && styles.viewOptionActive]}><Text style={[styles.viewOptionText, viewMode === 'list' && styles.viewOptionTextActive]}>列表</Text></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearOptions}>
          <Pressable onPress={() => chooseYear(null)} style={[styles.yearChip, { backgroundColor: selectedYear === null ? colors.primary : readingTheme.surface }]}><Text style={[styles.yearText, { color: selectedYear === null ? '#FFFFFF' : readingTheme.secondary }]}>全部</Text></Pressable>
          {years.map((year) => <Pressable key={year} onPress={() => chooseYear(year)} style={[styles.yearChip, { backgroundColor: selectedYear === year ? colors.primary : readingTheme.surface }]}><Text style={[styles.yearText, { color: selectedYear === year ? '#FFFFFF' : readingTheme.secondary }]}>{year} 年</Text></Pressable>)}
        </ScrollView>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthOptions}>
        {months.slice(0, 12).map((month) => <Pressable key={month} onPress={() => chooseMonth(month)} style={[styles.monthChip, { backgroundColor: selectedMonth === month ? colors.primary : readingTheme.surface }]}><Text style={[styles.monthText, { color: selectedMonth === month ? '#FFFFFF' : readingTheme.secondary }]}>{Number(month.slice(5))} 月</Text></Pressable>)}
        <Pressable onPress={() => { setRangeStart(customRange?.start ?? ''); setRangeEnd(customRange?.end ?? ''); setRangeEditorVisible(true); }} style={[styles.monthChip, { backgroundColor: customRange ? colors.primary : readingTheme.surface }]}><Text style={[styles.monthText, { color: customRange ? '#FFFFFF' : readingTheme.secondary }]}>自定义</Text></Pressable>
      </ScrollView>
      <Text style={[styles.summaryText, { color: readingTheme.secondary }]}>{places.length} 个地点 · {visibleEntries.length} 次到访</Text>
      {footprintStory ? <Text style={[styles.story, { color: readingTheme.text, backgroundColor: readingTheme.surface }]}>🍃 {footprintStory}</Text> : null}
    </View>

    {viewMode === 'list' && places.length ? <View style={styles.listShell}>
      <TextInput value={placeSearch} onChangeText={setPlaceSearch} placeholder="搜索地点" placeholderTextColor={readingTheme.secondary} style={[styles.placeSearch, { backgroundColor: readingTheme.surface, color: readingTheme.text }]} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.listFilterScroll} contentContainerStyle={styles.listFilters}>
        <Pressable onPress={() => setPlaceSort((value) => value === 'recent' ? 'visits' : 'recent')} style={[styles.listFilter, { backgroundColor: readingTheme.surface }]}><Text style={styles.listFilterText}>{placeSort === 'recent' ? '最近到访' : '到访最多'} ⇅</Text></Pressable>
        <Pressable onPress={() => setFavoriteOnly((value) => !value)} style={[styles.listFilter, favoriteOnly && styles.listFilterActive, { backgroundColor: favoriteOnly ? colors.primary : readingTheme.surface }]}><Text style={[styles.listFilterText, favoriteOnly && styles.listFilterTextActive]}>★ 收藏</Text></Pressable>
        {(['家', '学校', '工作', '旅行', '常去', '想再去'] as LocationCategory[]).map((category) => <Pressable key={category} onPress={() => setCategoryFilter((value) => value === category ? null : category)} style={[styles.listFilter, { backgroundColor: categoryFilter === category ? colors.primary : readingTheme.surface }]}><Text style={[styles.listFilterText, categoryFilter === category && styles.listFilterTextActive]}>{category}</Text></Pressable>)}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.placeList} showsVerticalScrollIndicator={false}>
        {listPlaces.map((place) => {
          const preference = locationPreferences[place.name];
          return <Pressable key={place.id} onPress={() => router.push(`/location/${encodeURIComponent(place.name)}` as Href)} style={[styles.placeListRow, { backgroundColor: readingTheme.surface }]}>
            <View style={styles.placeListIcon}><Text style={styles.placeListLeaf}>{preference?.favorite ? '★' : '🍃'}</Text></View>
            <View style={styles.placeListCopy}><View style={styles.placeListNameRow}><Text numberOfLines={1} style={[styles.placeListName, { color: readingTheme.text }]}>{place.name}</Text>{preference?.category ? <Text style={styles.placeListCategory}>{preference.category}</Text> : null}</View><Text style={[styles.placeListMeta, { color: readingTheme.secondary }]}>{place.entries.length} 次到访 · 最近 {shortDate(place.entries[0].occurredAt)}</Text></View>
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
        maxZoom={19}
        compassEnabled
        zoomControlsEnabled={false}
        myLocationButtonEnabled={false}
        rotateGesturesEnabled={false}
        scrollGesturesEnabled
        tiltGesturesEnabled={false}
        zoomGesturesEnabled
        onCameraMove={(event) => setCurrentZoomBand((current) => {
          const zoom = event?.nativeEvent?.cameraPosition?.zoom;
          if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return current;
          const next = zoomBand(zoom);
          return current === next ? current : next;
        })}
        onLoad={() => {
          setMapReady(true);
          setMapTimedOut(false);
        }}
        onMapPress={() => setSelectedPlace(null)}
      >
        {clusters.map((cluster) => <Marker
          key={cluster.id}
          position={wgs84ToGcj02({ latitude: cluster.latitude, longitude: cluster.longitude })}
          title={cluster.places.length > 1 ? `${cluster.places.length} 个地点` : cluster.places[0].name}
          snippet={cluster.places.length > 1 ? '点击放大' : `${cluster.places[0].entries.length} 次到访`}
          pinColor="green"
          zIndex={cluster.places.reduce((total, place) => total + place.entries.length, 0)}
          onMarkerPress={() => chooseMarker(cluster.id)}
        />)}
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
      <Pressable accessibilityLabel="显示全部足迹" onPress={resetCamera} style={styles.resetButton}><Text style={styles.resetText}>◎</Text></Pressable>
      {illuminatedPlace ? <View pointerEvents="none" style={styles.illuminated}><Text style={styles.illuminatedLeaf}>🍃</Text><View><Text style={styles.illuminatedTitle}>地点已点亮</Text><Text numberOfLines={1} style={styles.illuminatedName}>{illuminatedPlace}</Text></View></View> : null}
    </View> : !places.length ? <View style={[styles.empty, { backgroundColor: readingTheme.surface }]}>
      <Text style={[styles.emptyTitle, { color: readingTheme.text }]}>还没有可点亮的地点</Text>
      <Text style={[styles.emptyText, { color: readingTheme.secondary }]}>记录时使用自动定位，保存坐标后就会出现在这里。</Text>
    </View> : null}

    {selectedPlace && selectedSummary ? <View style={[styles.placeCard, { backgroundColor: readingTheme.background, borderColor: readingTheme.border }]}>
      <View style={styles.placeHeader}><View style={styles.placeHeading}><Text numberOfLines={1} style={[styles.placeName, { color: readingTheme.text }]}>{selectedPlace.name}</Text><Text style={[styles.placeMeta, { color: readingTheme.secondary }]}>在这里留下的时光</Text></View><Pressable hitSlop={10} onPress={() => setSelectedPlace(null)}><Text style={[styles.close, { color: readingTheme.secondary }]}>×</Text></Pressable></View>
      <View style={[styles.placeStats, { backgroundColor: readingTheme.surface }]}>
        <View style={styles.placeStat}><Text style={styles.placeStatValue}>{selectedSummary.visits}</Text><Text style={[styles.placeStatLabel, { color: readingTheme.secondary }]}>到访次数</Text></View>
        <View style={styles.placeStat}><Text style={styles.placeStatValue}>{selectedSummary.visitDays}</Text><Text style={[styles.placeStatLabel, { color: readingTheme.secondary }]}>到访天数</Text></View>
        <View style={styles.placeStat}><Text style={styles.placeStatValue}>{shortDate(selectedSummary.firstVisitedAt)}</Text><Text style={[styles.placeStatLabel, { color: readingTheme.secondary }]}>初次到访</Text></View>
        <View style={styles.placeStat}><Text style={styles.placeStatValue}>{shortDate(selectedSummary.lastVisitedAt)}</Text><Text style={[styles.placeStatLabel, { color: readingTheme.secondary }]}>最近到访</Text></View>
      </View>
      <ScrollView nestedScrollEnabled style={styles.visitList}>
        {selectedPlace.entries.map((entry) => <Pressable key={entry.id} onPress={() => router.push({ pathname: '/entry/[id]', params: { id: entry.id } })} style={[styles.entryRow, { borderTopColor: readingTheme.border }]}><Text style={styles.entryDate}>{shortDate(entry.occurredAt)}</Text><Text numberOfLines={1} style={[styles.entryText, { color: readingTheme.text, fontFamily: readingFontFamily }]}>{entry.content}</Text><Text style={styles.arrow}>›</Text></Pressable>)}
      </ScrollView>
      <Pressable onPress={() => router.push(`/location/${encodeURIComponent(selectedPlace.name)}` as Href)} style={styles.placeDetailButton}><Text style={styles.placeDetailText}>查看地点详情 ›</Text></Pressable>
    </View> : null}

    {missingCoordinates && !selectedPlace ? <View style={styles.pendingArea}>
      <Pressable
        accessibilityState={{ expanded: pendingVisible }}
        onPress={() => setPendingVisible((value) => !value)}
        style={[styles.pendingToggle, { backgroundColor: readingTheme.surface }]}
      >
        <View style={styles.pendingHeading}><Text style={styles.pendingTitle}>{missingCoordinates} 条记录等待点亮</Text><Text style={[styles.pendingHint, { color: readingTheme.secondary }]}>已有地点名称，但还缺少地图坐标</Text></View>
        <Pressable disabled={backfilling} onPress={(event) => { event.stopPropagation(); setBackfillConfirmationVisible(true); }} style={styles.backfillButton}><Text style={styles.backfillText}>{backfilling ? '补全中…' : '智能补点'}</Text></Pressable>
        <Text style={styles.pendingArrow}>{pendingVisible ? '⌃' : '⌄'}</Text>
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
  back: { color: colors.primary, fontSize: 13 }, title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, headerSpace: { width: 42 },
  primaryFilters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  viewSwitch: { flexDirection: 'row', padding: 2, borderRadius: radii.pill },
  viewOption: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, viewOptionActive: { backgroundColor: colors.primary }, viewOptionText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' }, viewOptionTextActive: { color: '#FFFFFF' },
  summary: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xs }, yearOptions: { gap: spacing.xs }, yearChip: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, yearText: { fontSize: 10, fontWeight: '600' },
  monthOptions: { gap: spacing.xs, paddingTop: 3 }, monthChip: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, monthText: { fontSize: 10, fontWeight: '600' },
  summaryText: { marginTop: spacing.sm, fontSize: 11 }, story: { marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, fontSize: 11, lineHeight: 18 },
  mapShell: { flex: 1, overflow: 'hidden', marginHorizontal: spacing.md, borderRadius: radii.lg, backgroundColor: colors.primarySoft },
  listShell: { flex: 1 }, placeSearch: { height: 42, marginHorizontal: spacing.xl, paddingHorizontal: spacing.md, borderRadius: radii.pill, fontSize: 11 },
  listFilterScroll: { flexGrow: 0, height: 40 }, listFilters: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, paddingVertical: 4 }, listFilter: { minHeight: 30, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.pill }, listFilterActive: { backgroundColor: colors.primary }, listFilterText: { color: colors.primary, fontSize: 10, fontWeight: '700' }, listFilterTextActive: { color: '#FFFFFF' },
  placeList: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl }, placeListRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderRadius: radii.lg },
  placeListIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primarySoft }, placeListLeaf: { color: colors.primary, fontSize: 17 },
  placeListCopy: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md }, placeListNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, placeListName: { flexShrink: 1, fontFamily: fonts.serif, fontSize: 14, fontWeight: '600' },
  placeListCategory: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 11, fontWeight: '700' }, placeListMeta: { marginTop: 4, fontSize: 11 }, placeListArrow: { color: colors.primary, fontSize: 18 }, noPlaces: { paddingTop: spacing.xxl, textAlign: 'center', fontSize: 12 },
  mapLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, backgroundColor: colors.primarySoft },
  mapLoadingTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 17, textAlign: 'center' },
  mapLoadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  mapFailureActions: { width: '100%', maxWidth: 250, gap: spacing.sm, marginTop: spacing.lg },
  retryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, borderRadius: radii.pill, backgroundColor: colors.primary },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  listFallbackButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, listFallbackText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  resetButton: { position: 'absolute', right: spacing.md, bottom: spacing.md, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#FFFFFFEE', elevation: 4, shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } }, resetText: { color: colors.primary, fontSize: 23, lineHeight: 27 },
  illuminated: { position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, backgroundColor: '#FFFFFFF2', elevation: 5 }, illuminatedLeaf: { fontSize: 24 }, illuminatedTitle: { color: colors.primary, fontSize: 11, fontWeight: '800' }, illuminatedName: { maxWidth: 220, marginTop: 2, color: colors.text, fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', margin: spacing.xl, padding: spacing.xxl, borderRadius: radii.lg }, emptyTitle: { fontFamily: fonts.serif, fontSize: 18 }, emptyText: { marginTop: spacing.sm, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  placeCard: { marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg }, placeHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: spacing.sm }, placeHeading: { flex: 1, paddingRight: spacing.md }, placeName: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '600' }, placeMeta: { marginTop: 3, fontSize: 11 }, close: { minWidth: 44, minHeight: 44, paddingLeft: spacing.md, fontSize: 22, lineHeight: 44 },
  placeStats: { flexDirection: 'row', paddingVertical: spacing.sm, borderRadius: radii.md }, placeStat: { flex: 1, alignItems: 'center', paddingHorizontal: 2 }, placeStatValue: { color: colors.primary, fontSize: 12, fontWeight: '700' }, placeStatLabel: { marginTop: 2, fontSize: 11 },
  visitList: { maxHeight: 144, marginTop: spacing.xs }, entryRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth }, entryDate: { width: 54, color: colors.primary, fontSize: 11, fontWeight: '700' }, entryText: { flex: 1, fontSize: 12 }, arrow: { color: colors.primary, fontSize: 16 },
  placeDetailButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, placeDetailText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  pendingArea: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  pendingToggle: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radii.md },
  pendingHeading: { flex: 1, minWidth: 0 },
  pendingTitle: { color: colors.primary, fontSize: 12, fontWeight: '700' }, pendingHint: { marginTop: 2, fontSize: 11 },
  backfillButton: { minHeight: 36, justifyContent: 'center', marginLeft: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.primary }, backfillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  pendingArrow: { color: colors.primary, fontSize: 16 },
  pendingList: { marginTop: spacing.xs, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  pendingRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  pendingCopy: { flex: 1, paddingRight: spacing.md }, pendingLocation: { fontSize: 12, fontWeight: '600' }, pendingContent: { marginTop: 2, fontSize: 11 },
  pendingAction: { color: colors.primary, fontSize: 11, fontWeight: '700' }, pendingMore: { paddingVertical: spacing.md, fontSize: 11, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: '#00000055' }, rangeEditor: { padding: spacing.xl, borderRadius: radii.lg },
  rangeTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '600' }, rangeHint: { marginTop: spacing.xs, fontSize: 11 },
  rangeInputs: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }, rangeInput: { flex: 1, height: 44, paddingHorizontal: spacing.sm, borderRadius: radii.md, fontSize: 12 }, rangeDash: { fontSize: 11 },
  rangeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xl, marginTop: spacing.xl }, rangeCancel: { fontSize: 11 }, rangeSave: { color: colors.primary, fontSize: 11, fontWeight: '700' },
});
