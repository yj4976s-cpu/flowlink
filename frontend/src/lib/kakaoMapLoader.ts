import type { KakaoMapsNamespace } from "@/types/kakao-maps";

const KAKAO_MAP_SCRIPT_ID = "flowlink-kakao-map-sdk";

let kakaoMapsPromise: Promise<KakaoMapsNamespace> | null = null;

function getKakaoMapKey() {
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY?.trim();
  if (!key) {
    throw new Error("NEXT_PUBLIC_KAKAO_MAP_JS_KEY 환경 변수가 설정되지 않았습니다.");
  }
  return key;
}

function resolveKakaoMaps() {
  return new Promise<KakaoMapsNamespace>((resolve, reject) => {
    const maps = window.kakao?.maps;
    if (!maps) {
      reject(new Error("카카오 지도 SDK를 초기화하지 못했습니다."));
      return;
    }
    maps.load(() => resolve(maps));
  });
}

export function loadKakaoMaps() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("카카오 지도는 브라우저에서만 초기화할 수 있습니다."));
  }

  if (window.kakao?.maps) {
    return resolveKakaoMaps();
  }

  if (kakaoMapsPromise) {
    return kakaoMapsPromise;
  }

  kakaoMapsPromise = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    const key = getKakaoMapKey();
    const existingScript = document.getElementById(KAKAO_MAP_SCRIPT_ID) as HTMLScriptElement | null;

    const onLoad = () => {
      void resolveKakaoMaps().then(resolve, reject);
    };
    const onError = () => {
      kakaoMapsPromise = null;
      reject(new Error("카카오 지도 SDK를 불러오지 못했습니다."));
    };

    if (existingScript) {
      existingScript.addEventListener("load", onLoad, { once: true });
      existingScript.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = KAKAO_MAP_SCRIPT_ID;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });

  return kakaoMapsPromise;
}
