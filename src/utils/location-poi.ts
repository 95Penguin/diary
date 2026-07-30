export type NearbyPoi = {
  name: string;
  typeDes?: string;
  distance?: number;
};

const SPECIFIC_PLACE = /(图书馆|宿舍|公寓|教学楼|实验楼|办公楼|体育馆|体育场|食堂|餐厅|咖啡|商店|超市|酒店|医院|诊所|影院|剧院|博物馆|美术馆|公园|景点|车站|地铁站|机场|书店|展馆|中心|大厦|广场|门店|校门)/;
const BROAD_PLACE = /(大学|学院|学校|校区|园区|小区|社区|街道|道路|区|市)$/;
const LOW_DETAIL_TYPE = /(行政地名|道路附属设施|地名地址信息|门牌信息)/;

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s·•,，.。()（）\-_/]/g, '');
}

function poiScore(poi: NearbyPoi, index: number, query?: string) {
  const name = poi.name.trim();
  const type = poi.typeDes ?? '';
  const distance = Number.isFinite(poi.distance) ? Math.max(0, poi.distance ?? 0) : index * 15;
  let score = -Math.min(60, distance / 8) - index * 0.25;
  if (SPECIFIC_PLACE.test(name) || SPECIFIC_PLACE.test(type)) score += 55;
  if (BROAD_PLACE.test(name)) score -= 24;
  if (LOW_DETAIL_TYPE.test(type)) score -= 45;
  if (query?.trim()) {
    const keyword = normalized(query);
    const candidate = normalized(name);
    if (candidate === keyword) score += 90;
    else if (candidate.includes(keyword) || keyword.includes(candidate)) score += 30;
  }
  return score;
}

export function rankNearbyPois<T extends NearbyPoi>(pois: T[], query?: string) {
  return pois
    .map((poi, index) => ({ poi, index, score: poiScore(poi, index, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ poi }) => poi);
}
