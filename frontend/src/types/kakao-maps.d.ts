export type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};

export type KakaoLatLngBounds = {
  extend(position: KakaoLatLng): void;
};

export type KakaoMap = {
  addControl(control: unknown, position: number): void;
  panTo(position: KakaoLatLng): void;
  relayout?: () => void;
  setBounds(bounds: KakaoLatLngBounds): void;
  setCenter(position: KakaoLatLng): void;
  setLevel(level: number): void;
};

export type KakaoCustomOverlay = {
  setMap(map: KakaoMap | null): void;
};

export type KakaoMapsNamespace = {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
  CustomOverlay: new (options: { position: KakaoLatLng; content: HTMLElement; yAnchor?: number; zIndex?: number }) => KakaoCustomOverlay;
  ZoomControl: new () => unknown;
  ControlPosition: {
    RIGHT: number;
  };
};

declare global {
  interface Window {
    kakao?: {
      maps: KakaoMapsNamespace;
    };
  }
}
