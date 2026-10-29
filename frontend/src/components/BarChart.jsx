/** Accessible, dependency-free bar chart for small daily series. */
export default function BarChart({ data, valueKey, labelKey = 'date', height = 180, label }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="100" y1={(height / 2) * f} y2={(height / 2) * f} stroke="#e3e8e4" strokeWidth=".2" />
        ))}
        {data.map((d, i) => {
          const h = (d[valueKey] / max) * (height / 2 - 4);
          return (
            <rect key={d[labelKey]} x={i * w + w * 0.18} width={w * 0.64} y={height / 2 - h} height={Math.max(h, d[valueKey] ? 0.6 : 0)}
              rx=".8" fill={i === data.length - 1 ? '#C8A24A' : '#17805F'}>
              <title>{`${d[labelKey]}: ${d[valueKey]}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{data[0]?.[labelKey]?.slice(5)}</span><span>{data[Math.floor(data.length / 2)]?.[labelKey]?.slice(5)}</span><span>Today</span>
      </div>
      <figcaption className="sr-only">{label}: {data.map((d) => `${d[labelKey]} ${d[valueKey]}`).join(', ')}</figcaption>
    </figure>
  );
}
