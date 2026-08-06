import { Icon } from "@/components/common/Icon";
import { homeStats } from "@/data/mock-home";

export function StatsStrip() {
  return (
    <section className="stats-wrap" aria-label="FlowLink 서비스 현황 데모">
      <div className="stats-strip">
        {homeStats.map((stat) => (
          <div className="stat" key={stat.label}>
            <span className="stat-icon"><Icon name={stat.icon} /></span>
            <span className="stat-copy"><small>{stat.label}</small><strong>{stat.value}<i>{stat.suffix}</i></strong></span>
          </div>
        ))}
      </div>
    </section>
  );
}
