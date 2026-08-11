"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { searchKakaoPlacesPage, type KakaoPlace } from "@/lib/kakaoPlaces";
import styles from "./Community.module.css";

export type CommunityPlace = { placeName: string; address: string; roadAddress?: string; latitude: number; longitude: number };
export function CommunityPlaceSearch({ value, optional = false, onChange, onSelect }: { value: string; optional?: boolean; onChange: (value: string) => void; onSelect: (place: CommunityPlace | null) => void }) {
  const [items, setItems] = useState<KakaoPlace[]>([]); const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false); const sequence = useRef(0); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (value.trim().length < 2) return; const id = ++sequence.current; const timer = window.setTimeout(() => { setLoading(true); void searchKakaoPlacesPage(value.trim()).then(({ places }) => { if (sequence.current === id) { setItems(places); setOpen(true); } }).catch(() => { if (sequence.current === id) setItems([]); }).finally(() => { if (sequence.current === id) setLoading(false); }); }, 300); return () => window.clearTimeout(timer); }, [value]);
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [open]);
  const choose = (item: KakaoPlace) => { const place = { placeName: item.place_name, address: item.address_name, roadAddress: item.road_address_name || undefined, latitude: Number(item.y), longitude: Number(item.x) }; onChange(place.placeName); onSelect(place); setOpen(false); };
  return <div className={styles.placeSearch} ref={root}><Icon name="location" size={18} /><input value={value} onChange={(event) => { onChange(event.target.value); onSelect(null); if (event.target.value.trim().length < 2) setOpen(false); }} onFocus={() => items.length && setOpen(true)} placeholder="장소명이나 지역명을 검색해 주세요" aria-label="커뮤니티 지역 검색" />{value && <button type="button" aria-label="지역 초기화" onClick={() => { onChange(""); onSelect(null); setOpen(false); }}><Icon name="close" size={15} /></button>}{open && <div className={styles.placeResults} role="listbox">{loading && <p>장소를 찾고 있어요.</p>}{!loading && items.map((item) => <button type="button" role="option" aria-selected="false" key={item.id} onClick={() => choose(item)}><strong>{item.place_name}</strong><small>{item.road_address_name || item.address_name}</small></button>)}</div>}{optional && <small>위치는 선택 사항이에요.</small>}</div>;
}
