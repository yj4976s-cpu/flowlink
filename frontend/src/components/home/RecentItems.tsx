import Link from "next/link";
import { Icon } from "@/components/common/Icon";
import type { HomeRecentItem } from "@/types/home";
import { ObjectIllustration } from "./ObjectIllustration";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

function FoundItemCard({ item }: { item: HomeRecentItem }) {
  return (
    <article className={`found-card found-card-${item.objectKind}`}>
      <div className={`found-visual found-${item.objectKind}`}>
        {item.imageUrl ? <>
          {/* Public upload/storage URLs can come from the backend or object storage. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imageUrl} alt={`${item.title} 이미지`} />
        </> : <ObjectIllustration kind={item.objectKind} title={`${item.title} 이미지`} />}
      </div>
      <div className="found-content">
        <span className={`category-chip category-${item.objectKind}`}>{item.category}</span>
        <h3>{item.title}</h3>
        <p><Icon name="location" size={15} /> {item.location}</p>
        <time dateTime={item.foundAt}><Icon name="clock" size={15} /> {formatter.format(new Date(item.foundAt))}</time>
        <div className="confidence"><span>{item.confidence == null ? "공개 발견 정보" : "탐지 신뢰도"}</span><strong>{item.confidence == null ? "확인 중" : `${item.confidence}%`}</strong></div>
      </div>
    </article>
  );
}

export function RecentItems({ items }: { items: HomeRecentItem[] }) {
  return (
    <section className="section recent-section" id="recent-items" aria-labelledby="recent-title">
      <div className="recent-heading">
        <div><p>RECENT ITEMS</p><h2 id="recent-title">최근 공개 발견물</h2></div>
        <Link className="recent-more" href="/found-items">전체 보기</Link>
      </div>
      {items.length ? <div className="recent-grid" role="list" aria-label="최근 공개 발견물 목록">
        {items.map((item) => <div role="listitem" key={item.id}><FoundItemCard item={item} /></div>)}
      </div> : <p className="recent-empty" role="status">아직 공개할 최근 발견물이 없습니다.</p>}
    </section>
  );
}
