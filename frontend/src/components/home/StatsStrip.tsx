import { Icon } from "@/components/common/Icon";
import type { HomeStats } from "@/types/home";

const statItems = (stats: HomeStats) => [
  { label: "최근 발견", value: stats.recentFound, suffix: "건", icon: "scan" as const },
  { label: "매칭 진행", value: stats.matchingActive, suffix: "건", icon: "document" as const },
  { label: "반환 완료", value: stats.returned, suffix: "건", icon: "check" as const },
  { label: "오늘 탐지", value: stats.todayDetections, suffix: "건", icon: "spark" as const },
];

export function StatsStrip({ stats }: { stats: HomeStats }) {
  return (
    <section className="stats-wrap" aria-label="FlowLink 서비스 현황">
      <div className="stats-strip">
        {statItems(stats).map((stat) => (
          <div className="stat" key={stat.label}>
            <span className="stat-icon"><Icon name={stat.icon} /></span>
            <span className="stat-copy"><small>{stat.label}</small><strong>{stat.value}<i>{stat.suffix}</i></strong></span>
          </div>
        ))}
      </div>
    </section>
  );
}
