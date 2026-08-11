export type KakaoPlace = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
};

type KakaoPlacesStatus = "OK" | "ZERO_RESULT" | "ERROR";
type KakaoPagination = { hasNextPage: boolean };
type KakaoPlacesService = {
  keywordSearch: (query: string, callback: (places: KakaoPlace[], status: KakaoPlacesStatus, pagination: KakaoPagination) => void, options?: { size?: number; page?: number }) => void;
};
export type KakaoAddressResult = { address?: { address_name: string; region_1depth_name: string; region_2depth_name: string; region_3depth_name: string }; road_address?: { address_name: string } | null };
type KakaoGeocoder = { coord2Address: (longitude: number, latitude: number, callback: (results: KakaoAddressResult[], status: KakaoPlacesStatus) => void) => void };
export type KakaoServices = {
  Places: new () => KakaoPlacesService;
  Geocoder: new () => KakaoGeocoder;
  Status: { OK: KakaoPlacesStatus; ZERO_RESULT: KakaoPlacesStatus; ERROR: KakaoPlacesStatus };
};
export type KakaoLatLng = { getLat: () => number; getLng: () => number };
export type KakaoLatLngBoundsInstance = { extend: (position: KakaoLatLng) => void };
export type KakaoMapInstance = { setCenter: (position: KakaoLatLng) => void; setBounds: (bounds: KakaoLatLngBoundsInstance, padding?: number) => void; getLevel: () => number; setLevel: (level: number, options?: { anchor?: KakaoLatLng }) => void; relayout: () => void };
export type KakaoMarkerInstance = { setPosition: (position: KakaoLatLng) => void; setMap: (map: KakaoMapInstance | null) => void };
export type KakaoCustomOverlayInstance = { setMap: (map: KakaoMapInstance | null) => void };
export type KakaoCircleInstance = { setPosition: (position: KakaoLatLng) => void; setMap: (map: KakaoMapInstance | null) => void };
export type KakaoRoot = {
  maps: {
    load: (callback: () => void) => void;
    Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMapInstance;
    LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
    LatLngBounds: new () => KakaoLatLngBoundsInstance;
    Marker: new (options: { map: KakaoMapInstance; position: KakaoLatLng }) => KakaoMarkerInstance;
    CustomOverlay: new (options: { map: KakaoMapInstance; position: KakaoLatLng; content: HTMLElement; xAnchor?: number; yAnchor?: number; zIndex?: number }) => KakaoCustomOverlayInstance;
    Circle: new (options: { map: KakaoMapInstance; center: KakaoLatLng; radius: number; strokeWeight: number; strokeColor: string; strokeOpacity: number; fillColor: string; fillOpacity: number }) => KakaoCircleInstance;
    event: { addListener: (target: KakaoMapInstance | KakaoMarkerInstance, type: string, handler: (event: { latLng: KakaoLatLng }) => void) => void; removeListener: (target: KakaoMapInstance | KakaoMarkerInstance, type: string, handler: (event: { latLng: KakaoLatLng }) => void) => void };
    services?: KakaoServices;
  };
};

const SDK_SELECTOR = 'script[src*="dapi.kakao.com/v2/maps/sdk.js"]';
let loaderPromise: Promise<KakaoRoot> | null = null;

function getKakaoRoot() {
  return (window as unknown as { kakao?: KakaoRoot }).kakao;
}

function resolveSdk(resolve: (kakao: KakaoRoot) => void, reject: (error: Error) => void) {
  const kakao = getKakaoRoot();
  if (!kakao?.maps?.load) {
    reject(new Error("카카오 지도 SDK를 사용할 수 없습니다."));
    return;
  }
  kakao.maps.load(() => {
    const loaded = getKakaoRoot();
    if (loaded?.maps.services?.Places && loaded.maps.Map) resolve(loaded);
    else reject(new Error("카카오 장소 검색 라이브러리가 로드되지 않았습니다."));
  });
}

export function loadKakaoMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("카카오 장소 검색은 브라우저에서만 사용할 수 있습니다."));
  const loaded = getKakaoRoot();
  if (loaded?.maps.services?.Places && loaded.maps.Map) return Promise.resolve(loaded);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<KakaoRoot>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(SDK_SELECTOR);
    if (existingScript) {
      if (getKakaoRoot()?.maps) { resolveSdk(resolve, reject); return; }
      existingScript.addEventListener("load", () => resolveSdk(resolve, reject), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("카카오 지도 SDK를 불러오지 못했습니다.")), { once: true });
      return;
    }

    const appKey = (process.env.NEXT_PUBLIC_KAKAO_MAP_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY)?.trim();
    if (!appKey) { reject(new Error("카카오 지도 JavaScript 키가 설정되지 않았습니다.")); return; }
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
    script.async = true;
    script.dataset.flowlinkKakaoSdk = "true";
    script.addEventListener("load", () => resolveSdk(resolve, reject), { once: true });
    script.addEventListener("error", () => reject(new Error("카카오 지도 SDK를 불러오지 못했습니다.")), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    loaderPromise = null;
    throw error;
  });
  return loaderPromise;
}

export async function loadKakaoPlaces() {
  const kakao = await loadKakaoMaps();
  if (!kakao.maps.services) throw new Error("카카오 장소 검색 라이브러리가 로드되지 않았습니다.");
  return kakao.maps.services;
}

export const FLOWLINK_DEFAULT_MAP_CENTER = { latitude: 37.5665, longitude: 126.9780 } as const;

export async function createFlowLinkMap(container: HTMLElement, options: { latitude?: number; longitude?: number; level?: number } = {}) {
  const kakao = await loadKakaoMaps();
  const latitude = options.latitude ?? FLOWLINK_DEFAULT_MAP_CENTER.latitude;
  const longitude = options.longitude ?? FLOWLINK_DEFAULT_MAP_CENTER.longitude;
  const center = new kakao.maps.LatLng(latitude, longitude);
  const map = new kakao.maps.Map(container, { center, level: options.level ?? 7 });
  let frame = window.requestAnimationFrame(() => { map.relayout(); map.setCenter(center); });
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => map.relayout());
  });
  observer?.observe(container);
  return { kakao, map, center, destroy: () => { window.cancelAnimationFrame(frame); observer?.disconnect(); } };
}

export async function searchKakaoPlacesPage(query: string, page = 1) {
  const services = await loadKakaoPlaces();
  const places = new services.Places();
  return new Promise<{ places: KakaoPlace[]; hasNextPage: boolean }>((resolve, reject) => {
    places.keywordSearch(query, (results, status, pagination) => {
      if (status === services.Status.OK) resolve({ places: results.slice(0, 15), hasNextPage: pagination.hasNextPage });
      else if (status === services.Status.ZERO_RESULT) resolve({ places: [], hasNextPage: false });
      else reject(new Error("카카오 장소 검색에 실패했습니다."));
    }, { size: 15, page });
  });
}

export async function searchKakaoPlaces(query: string) {
  return (await searchKakaoPlacesPage(query)).places;
}

export async function reverseGeocodeKakao(latitude: number, longitude: number) {
  const services = await loadKakaoPlaces();
  const geocoder = new services.Geocoder();
  return new Promise<KakaoAddressResult | null>((resolve, reject) => {
    geocoder.coord2Address(longitude, latitude, (results, status) => {
      if (status === services.Status.OK) resolve(results[0] ?? null);
      else if (status === services.Status.ZERO_RESULT) resolve(null);
      else reject(new Error("선택 위치의 주소를 확인하지 못했습니다."));
    });
  });
}
