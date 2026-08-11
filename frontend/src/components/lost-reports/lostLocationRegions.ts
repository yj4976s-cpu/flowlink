import { KOREA_REGION_DATA, type RegionDataNode } from "./koreaRegionData";

export type RegionNode = { name: string; children?: RegionNode[] };

const adaptRegion = ({ n, c }: RegionDataNode): RegionNode => ({
  name: n,
  ...(c?.length ? { children: c.map(adaptRegion) } : {}),
});

// UI는 이 adapter만 소비하므로 원천 데이터 형식이 바뀌어도 picker는 영향을 받지 않습니다.
export const LOST_LOCATION_REGIONS: RegionNode[] = KOREA_REGION_DATA.map(adaptRegion);
