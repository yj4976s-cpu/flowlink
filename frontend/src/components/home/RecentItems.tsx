import Link from "next/link";
import { Icon } from "@/components/common/Icon";
import { recentItems } from "@/data/mock-home";
import type { FoundItem } from "@/types/home";
import { ObjectIllustration } from "./ObjectIllustration";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

function FoundItemCard({ item }: { item: FoundItem }) {
  return (
    <article className={`found-card found-card-${item.objectKind}`}>
      <div className={`found-visual found-${item.objectKind}`}><ObjectIllustration kind={item.objectKind} title={`${item.title} 이미지`} /></div>
      <div className="found-content">
        <span className={`category-chip category-${item.objectKind}`}>{item.category}</span>
        <h3>{item.title}</h3>
        <p><Icon name="location" size={15} /> {item.location}</p>
        <time dateTime={item.foundAt}><Icon name="clock" size={15} /> {formatter.format(new Date(item.foundAt))}</time>
        <div className="confidence"><span>탐지 신뢰도</span><strong>{item.confidence}%</strong></div>
      </div>
    </article>
  );
}

export function RecentItems() {
  return (
    <section className="section recent-section" id="recent-items" aria-labelledby="recent-title">
      <div className="recent-heading">
        <div><p>RECENT DETECTIONS</p><h2 id="recent-title">최근 탐지된 객체</h2></div>
        <Link className="recent-more" href="/found-items">전체 보기 <Icon name="arrow" size={18} /></Link>
      </div>
      <div className="recent-grid" role="list" aria-label="최근 탐지된 객체 목록">
        {recentItems.map((item) => <div role="listitem" key={item.id}><FoundItemCard item={item} /></div>)}
      </div>
    </section>
  );
}
