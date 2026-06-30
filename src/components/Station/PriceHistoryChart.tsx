import React, { useMemo, useRef, useState } from "react";
import styles from "./PriceHistoryChart.module.css";

export interface ChartPoint {
    t: number; // timestamp (ms)
    price: number;
}

export interface ChartSeries {
    label: string;
    color: string; // admite var(--...) para combinar con el tema
    points: ChartPoint[];
}

interface Props {
    series: ChartSeries[];
}

const DAY = 86_400_000;
const RANGES = [
    { label: "30 días", days: 30 },
    { label: "6 meses", days: 182 },
    { label: "1 año", days: 365 },
    { label: "Todo", days: Infinity },
] as const;

const W = 760;
const H = 300;
const M = { l: 52, r: 16, t: 18, b: 34 };
const innerW = W - M.l - M.r;
const innerH = H - M.t - M.b;

const fmtPrice = (p: number) => p.toFixed(3);
const dateShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const dateLong = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });

/** Precio de la serie en el instante t (se mantiene el último valor conocido). */
function valueAt(points: ChartPoint[], t: number): number | null {
    if (points.length === 0) return null;
    if (t <= points[0].t) return points[0].price;
    let v = points[0].price;
    for (const p of points) {
        if (p.t > t) break;
        v = p.price;
    }
    return v;
}

const PriceHistoryChart: React.FC<Props> = ({ series }) => {
    const allPoints = series.flatMap((s) => s.points);
    const hasAny = allPoints.length > 0;
    const spanDays = hasAny ? (Date.now() - Math.min(...allPoints.map((p) => p.t))) / DAY : 0;

    // Por defecto 30 días. Los rangos mayores solo se activan cuando hay histórico
    // suficiente para que tengan sentido (si no, salen deshabilitados).
    const [rangeIdx, setRangeIdx] = useState(0);
    const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const rangeEnabled = (r: (typeof RANGES)[number], i: number) => {
        if (i === 0) return true; // 30 días siempre
        if (r.days === Infinity) return spanDays > 365; // "Todo": útil con >1 año
        return spanDays >= r.days * 0.9;
    };

    const geo = useMemo(() => {
        const now = Date.now();
        const days = RANGES[rangeIdx].days;
        const start = days === Infinity ? Math.min(...(hasAny ? allPoints.map((p) => p.t) : [now])) : now - days * DAY;

        // Serie recortada al rango, con "arrastre" del último valor previo al inicio.
        const clipped = series.map((s) => {
            const inRange = s.points.filter((p) => p.t >= start);
            const before = s.points.filter((p) => p.t < start);
            const pts: ChartPoint[] = [];
            if (before.length) pts.push({ t: start, price: before[before.length - 1].price });
            pts.push(...inRange);
            return { ...s, pts };
        });

        const visible = clipped.filter((s) => s.pts.length > 0);
        const prices = visible.flatMap((s) => s.pts.map((p) => p.price));
        if (prices.length === 0) return null;

        let minP = Math.min(...prices);
        let maxP = Math.max(...prices);
        if (minP === maxP) {
            minP -= 0.05;
            maxP += 0.05;
        } else {
            const pad = (maxP - minP) * 0.15;
            minP -= pad;
            maxP += pad;
        }
        const minT = start;
        const maxT = now;

        const x = (t: number) => M.l + ((t - minT) / (maxT - minT)) * innerW;
        const y = (p: number) => M.t + (1 - (p - minP) / (maxP - minP)) * innerH;
        const invX = (px: number) => minT + ((px - M.l) / innerW) * (maxT - minT);

        const stepPath = (pts: ChartPoint[]) => {
            if (!pts.length) return "";
            let d = `M ${x(pts[0].t).toFixed(1)} ${y(pts[0].price).toFixed(1)}`;
            for (let i = 1; i < pts.length; i++) {
                d += ` L ${x(pts[i].t).toFixed(1)} ${y(pts[i - 1].price).toFixed(1)}`;
                d += ` L ${x(pts[i].t).toFixed(1)} ${y(pts[i].price).toFixed(1)}`;
            }
            d += ` L ${x(maxT).toFixed(1)} ${y(pts[pts.length - 1].price).toFixed(1)}`;
            return d;
        };

        const yTicks = [minP, (minP + maxP) / 2, maxP].map((p) => ({ p, y: y(p) }));
        const xTickCount = 5;
        const xTicks = Array.from({ length: xTickCount }, (_, i) => {
            const t = minT + (i / (xTickCount - 1)) * (maxT - minT);
            return { t, x: x(t) };
        });

        return { x, y, invX, minT, maxT, minP, maxP, visible, clipped, stepPath, yTicks, xTicks };
    }, [rangeIdx, series, hasAny]);

    const onMove = (e: React.PointerEvent) => {
        if (!geo || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        if (px < M.l || px > W - M.r) {
            setHover(null);
            return;
        }
        setHover({ x: px, t: geo.invX(px) });
    };

    if (!hasAny || !geo) {
        return (
            <p className={styles.empty}>
                Aún no hay suficiente histórico para mostrar la evolución. Lo registramos a diario y
                aquí verás cómo cambia el precio con el tiempo.
            </p>
        );
    }

    const hoverDate = hover ? dateLong.format(new Date(hover.t)) : "";

    return (
        <div className={styles.wrap}>
            <div className={styles.ranges}>
                {RANGES.map((r, i) => {
                    const en = rangeEnabled(r, i);
                    return (
                        <button
                            key={r.label}
                            className={`${styles.rangeBtn} ${i === rangeIdx ? styles.active : ""}`}
                            onClick={() => en && setRangeIdx(i)}
                            disabled={!en}
                            title={en ? undefined : "Disponible cuando haya más histórico"}
                        >
                            {r.label}
                        </button>
                    );
                })}
            </div>

            <div className={styles.chartBox}>
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    className={styles.svg}
                    preserveAspectRatio="none"
                    onPointerMove={onMove}
                    onPointerLeave={() => setHover(null)}
                    role="img"
                    aria-label="Evolución del precio del combustible"
                >
                    {/* Cuadrícula + etiquetas Y */}
                    {geo.yTicks.map((tk, i) => (
                        <g key={i}>
                            <line x1={M.l} y1={tk.y} x2={W - M.r} y2={tk.y} stroke="var(--border)" strokeWidth={1} opacity={0.6} />
                            <text x={M.l - 8} y={tk.y} textAnchor="end" dominantBaseline="middle" className={styles.axisText}>
                                {fmtPrice(tk.p)}
                            </text>
                        </g>
                    ))}

                    {/* Etiquetas X */}
                    {geo.xTicks.map((tk, i) => (
                        <g key={i}>
                            <line x1={tk.x} y1={H - M.b} x2={tk.x} y2={H - M.b + 4} stroke="var(--text-muted)" strokeWidth={1} />
                            <text
                                x={tk.x}
                                y={H - M.b + 18}
                                textAnchor={i === 0 ? "start" : i === geo.xTicks.length - 1 ? "end" : "middle"}
                                className={styles.axisText}
                            >
                                {dateShort.format(new Date(tk.t))}
                            </text>
                        </g>
                    ))}

                    {/* Líneas */}
                    {geo.visible.map((s, i) => (
                        <path key={i} d={geo.stepPath(s.pts)} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                    ))}

                    {/* Guía + puntos del hover */}
                    {hover && (
                        <g>
                            <line x1={hover.x} y1={M.t} x2={hover.x} y2={H - M.b} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" />
                            {geo.visible.map((s, i) => {
                                const v = valueAt(s.pts, hover.t);
                                if (v == null) return null;
                                return <circle key={i} cx={hover.x} cy={geo.y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
                            })}
                        </g>
                    )}
                </svg>

                {/* Tooltip (HTML, posicionado en %) */}
                {hover && (
                    <div
                        className={styles.tooltip}
                        style={{ left: `${(hover.x / W) * 100}%`, transform: `translateX(${hover.x > W * 0.6 ? "-100%" : "0"})` }}
                    >
                        <div className={styles.ttDate}>{hoverDate}</div>
                        {geo.visible.map((s, i) => {
                            const v = valueAt(s.pts, hover.t);
                            return (
                                <div key={i} className={styles.ttRow}>
                                    <span className={styles.ttDot} style={{ background: s.color }} />
                                    {s.label}: <b>{v != null ? `${fmtPrice(v)} €/L` : "—"}</b>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className={styles.legend}>
                {series.map((s, i) => (
                    <span key={i} className={styles.legendItem}>
                        <span className={styles.legendDot} style={{ background: s.color }} />
                        {s.label}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default PriceHistoryChart;
