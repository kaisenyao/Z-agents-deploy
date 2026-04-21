import { useEffect, useRef, useState } from 'react';
import type { LightweightChartSpec, LightweightSeriesType } from '../services/api';

declare global {
  interface Window {
    LightweightCharts?: any;
  }
}

let lightweightChartsLoader: Promise<any> | null = null;

function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (lightweightChartsLoader) return lightweightChartsLoader;

  lightweightChartsLoader = new Promise((resolve, reject) => {
    const scriptId = 'lightweight-charts-standalone';
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(window.LightweightCharts));
      existing.addEventListener('error', () => reject(new Error('Failed to load lightweight charts')));
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js';
    script.async = true;
    script.onload = () => resolve(window.LightweightCharts);
    script.onerror = () => reject(new Error('Failed to load lightweight charts'));
    document.head.appendChild(script);
  });

  return lightweightChartsLoader;
}

function addSeries(chart: any, LightweightCharts: any, type: LightweightSeriesType, options: Record<string, any> = {}) {
  // Lightweight Charts v5 uses chart.addSeries(Constructor, options),
  // while older versions expose chart.addLineSeries/addCandlestickSeries helpers.
  if (typeof chart.addSeries === 'function') {
    const ctorMap: Record<LightweightSeriesType, any> = {
      candlestick: LightweightCharts?.CandlestickSeries,
      bar: LightweightCharts?.BarSeries,
      line: LightweightCharts?.LineSeries,
      area: LightweightCharts?.AreaSeries,
      baseline: LightweightCharts?.BaselineSeries,
      histogram: LightweightCharts?.HistogramSeries,
    };
    const ctor = ctorMap[type];
    if (ctor) return chart.addSeries(ctor, options);
  }

  switch (type) {
    case 'candlestick':
      return typeof chart.addCandlestickSeries === 'function' ? chart.addCandlestickSeries(options) : null;
    case 'bar':
      return typeof chart.addBarSeries === 'function' ? chart.addBarSeries(options) : null;
    case 'line':
      return typeof chart.addLineSeries === 'function' ? chart.addLineSeries(options) : null;
    case 'area':
      return typeof chart.addAreaSeries === 'function' ? chart.addAreaSeries(options) : null;
    case 'baseline':
      return typeof chart.addBaselineSeries === 'function' ? chart.addBaselineSeries(options) : null;
    case 'histogram':
      return typeof chart.addHistogramSeries === 'function' ? chart.addHistogramSeries(options) : null;
    default:
      return null;
  }
}

interface Props {
  chart: LightweightChartSpec;
}

export function LightweightChartCard({ chart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let chartInstance: any = null;
    let observer: ResizeObserver | null = null;

    const mount = async () => {
      const container = containerRef.current;
      if (!container) return;

      try {
        const LightweightCharts = await loadLightweightCharts();
        if (disposed || !container) return;

        const chartHeight = 320;
        const width = Math.max(container.clientWidth, 240);

        chartInstance = LightweightCharts.createChart(container, {
          width,
          height: chartHeight,
          layout: {
            background: { type: 'solid', color: '#0B1220' },
            textColor: '#C7D2FE',
          },
          grid: {
            vertLines: { color: 'rgba(148, 163, 184, 0.10)' },
            horzLines: { color: 'rgba(148, 163, 184, 0.10)' },
          },
          rightPriceScale: { borderColor: 'rgba(148, 163, 184, 0.25)' },
          timeScale: { borderColor: 'rgba(148, 163, 184, 0.25)' },
          crosshair: { mode: 1 },
          ...(chart.options || {}),
        });

        for (const seriesSpec of chart.series) {
          const series = addSeries(chartInstance, LightweightCharts, seriesSpec.type, seriesSpec.options || {});
          if (series && Array.isArray(seriesSpec.data)) {
            series.setData(seriesSpec.data);
          }
        }

        chartInstance.timeScale().fitContent();

        observer = new ResizeObserver(() => {
          if (!chartInstance || !container) return;
          chartInstance.applyOptions({
            width: Math.max(container.clientWidth, 240),
            height: chartHeight,
          });
        });
        observer.observe(container);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load chart');
      }
    };

    mount();

    return () => {
      disposed = true;
      if (observer) observer.disconnect();
      if (chartInstance) chartInstance.remove();
    };
  }, [chart]);

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        Failed to render chart: {loadError}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900/40">
      <div className="px-3 py-2 border-b border-slate-700/80 text-xs text-slate-300">
        {chart.title || 'Interactive Chart'}
      </div>
      <div ref={containerRef} className="w-full h-[320px]" />
    </div>
  );
}
