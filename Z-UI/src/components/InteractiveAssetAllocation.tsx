import { useMemo, useState } from "react";

interface AssetData {
  id: string;
  name: string;
  percentage: number;
  value: number;
  color: string;
}

interface InteractiveAssetAllocationProps {
  data: AssetData[];
  totalValue: number;
}

// Donut geometry constants
const SVG_SIZE = 220;
const CENTER = SVG_SIZE / 2;
const RADIUS = 84;
const STROKE_WIDTH = 18;
const INNER_RADIUS = RADIUS - STROKE_WIDTH;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function InteractiveAssetAllocation({
  data,
  totalValue,
}: InteractiveAssetAllocationProps) {
  const [hoveredAsset, setHoveredAsset] = useState<string | null>(null);

  // Memoized segments calculation
  const segments = useMemo(() => {
    let cumulativePercent = 0;
    return data.map((asset) => {
      const startPercent = cumulativePercent;
      cumulativePercent += asset.percentage;

      return {
        ...asset,
        dashLength: (asset.percentage / 100) * CIRCUMFERENCE,
        dashOffset: -(startPercent / 100) * CIRCUMFERENCE,
      };
    });
  }, [data]);

  // Memoized active segment lookup
  const activeSegment = useMemo(
    () => segments.find((s) => s.id === hoveredAsset) ?? null,
    [hoveredAsset, segments]
  );

  // Format currency
  const formatMoney = (n: number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Donut Chart */}
      <div className="flex items-center justify-center">
        <svg width={SVG_SIZE} height={SVG_SIZE} viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
          {/* Background ring */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="#1e293b"
            strokeWidth={STROKE_WIDTH}
          />

          {/* Segments */}
          {segments.map((segment) => {
            const isHovered = hoveredAsset === segment.id;
            const isOtherHovered = hoveredAsset !== null && !isHovered;

            return (
              <circle
                key={segment.id}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={segment.color}
                strokeWidth={isHovered ? STROKE_WIDTH + 2 : STROKE_WIDTH}
                strokeDasharray={`${segment.dashLength} ${CIRCUMFERENCE}`}
                strokeDashoffset={segment.dashOffset}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
                style={{
                  opacity: isOtherHovered ? 0.4 : 1,
                  transition: "all 200ms ease",
                  cursor: "pointer",
                  filter: isHovered ? `drop-shadow(0 0 6px ${segment.color})` : "none",
                }}
                onMouseEnter={() => setHoveredAsset(segment.id)}
                onMouseLeave={() => setHoveredAsset(null)}
              />
            );
          })}

          {/* Center hole */}
          <circle cx={CENTER} cy={CENTER} r={INNER_RADIUS} fill="#0f172a" />

          {/* Center text */}
          <text x={CENTER} y={CENTER} textAnchor="middle" className="fill-slate-100">
            {/* Title */}
            <tspan
              x={CENTER}
              dy={-18}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                opacity: 0.6,
              }}
            >
              {activeSegment ? activeSegment.name : "Total Portfolio"}
            </tspan>

            {/* Value */}
            <tspan
              x={CENTER}
              dy={26}
              style={{
                fontSize: "26px",
                fontWeight: 800,
                opacity: 1,
                letterSpacing: "-0.01em",
              }}
            >
              ${formatMoney(activeSegment ? activeSegment.value : totalValue)}
            </tspan>

            {/* Percentage (hover only) */}
            {activeSegment && (
              <tspan
                x={CENTER}
                dy={22}
                style={{
                  fontSize: "13px",
                  fontWeight: 650,
                  opacity: 0.75,
                }}
              >
                {activeSegment.percentage}%
              </tspan>
            )}
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="w-full space-y-1.5">
        {data.map((asset) => {
          const isHovered = hoveredAsset === asset.id;
          const isOtherHovered = hoveredAsset !== null && !isHovered;

          return (
            <div
              key={asset.id}
              className="flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-all duration-200"
              style={{
                backgroundColor: isHovered ? "rgba(80, 200, 120, 0.08)" : "transparent",
                opacity: isOtherHovered ? 0.4 : 1,
              }}
              onMouseEnter={() => setHoveredAsset(asset.id)}
              onMouseLeave={() => setHoveredAsset(null)}
            >
              <div className="flex items-center gap-2">
                <div
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: asset.color,
                    boxShadow: isHovered ? `0 0 8px ${asset.color}` : "none",
                    transform: isHovered ? "scale(1.25)" : "scale(1)",
                  }}
                />
                <span className="text-slate-300 text-[13px] leading-[18px]">
                  {asset.name}
                </span>
              </div>
              <span className="text-slate-400 font-medium text-[13px] leading-[18px]">
                {asset.percentage}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}