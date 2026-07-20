import type { ImpactMetrics } from '@/lib/api/impact';

const fmt = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** The six headline impact figures as a stat grid. Labelled "estimated" where the API is. */
export function ImpactMetricsGrid({ metrics }: { metrics: ImpactMetrics }) {
  const stats: { value: string; label: string }[] = [
    { value: `${fmt(metrics.recycledKg)} kg`, label: 'Paper recycled' },
    { value: `${fmt(metrics.landfillDivertedKg)} kg`, label: 'Landfill diverted (measured)' },
    { value: `${fmt(metrics.estimatedCo2eAvoidedKg)} kg`, label: 'Est. CO₂e avoided' },
    { value: `${fmt(metrics.estimatedWaterSavedLitres)} L`, label: 'Est. water saved' },
    { value: `${fmt(metrics.estimatedEnergySavedKwh)} kWh`, label: 'Est. energy saved' },
    { value: fmt(metrics.estimatedTreesEquivalent), label: 'Est. trees-equivalent' },
  ];

  return (
    <div className="stat-grid">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat__value">{s.value}</div>
          <div className="stat__label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
