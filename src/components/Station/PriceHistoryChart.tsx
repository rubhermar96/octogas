import React, { useMemo, useRef, useState } from "react";
import type { FuelType } from "../../types/gasolinera";
import { FUEL_LABELS, MAIN_FUELS, OTHER_FUELS, FUEL_ORDER } from "../../lib/fuels";
import styles from "./PriceHistoryChart.module.css";

export interface ChartPoint {
    t: number; // timestamp (ms)
    price: number;
}

interface Props {
    /** Histórico por combustible; solo se ofrecen al usuario los que tienen datos. */
    history: Partial<Record<FuelType, ChartPoint[]>>;
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
const LINE_COLOR = "var(--primary)";

const fmtPrice = (p: number) => p.toFixed(3);
// timeZone fijo a UTC: el día mostrado no depende de la zona horaria del visitante
// (las medias diarias son fechas de calendario, no instantes puntuales).
const dateShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const dateLong = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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

const PriceHistoryChart: React.FC<Props> = ({ history }) => {
    // Solo ofrecemos combustibles con datos reales (ningún favoritismo: el que más
    // historial tenga sale seleccionado por defecto, sea cual sea).
    const available = useMemo(() => FUEL_ORDER.filter((f) => (history[f]?.length ?? 0) > 0), [history]);
    const defaultFuel = useMemo(
        () => available.reduce<FuelType | null>((best, f) => {
            if (!best) return f;
            return (history[f]?.length ?? 0) > (history[best]?.length ?? 0) ? f : best;
        }, null),
        [available, history]
    );

    const [selectedFuel, setSelectedFuel] = useState<FuelType | null>(defaultFuel);
    const fuel = selectedFuel && available.includes(selectedFuel) ? selectedFuel : defaultFuel;
    const points = (fuel && history[fuel]) || [];

    const hasAny = points.length > 0;
    const spanDays = hasAny ? (Date.now() - Math.min(...points.map((p) => p.t))) / DAY : 0;

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
        if (points.length === 0) return null;
        const now = Date.now();
        const days = RANGES[rangeIdx].days;
        const start = days === Infinity ? Math.min(...points.map((p) => p.t)) : now - days * DAY;

        // Recorte al rango, con "arrastre" del último valor previo al inicio.
        const inRange = points.filter((p) => p.t >= start);
        const before = points.filter((p) => p.t < start);
        const pts: ChartPoint[] = [];
        if (before.length) pts.push({ t: start, price: before[before.length - 1].price });
        pts.push(...inRange);
        if (pts.length === 0) return null;

        let minP = Math.min(...pts.map((p) => p.price));
        let maxP = Math.max(...pts.map((p) => p.price));
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

        let d = `M ${x(pts[0].t).toFixed(1)} ${y(pts[0].price).toFixed(1)}`;
        for (let i = 1; i < pts.length; i++) {
            d += ` L ${x(pts[i].t).toFixed(1)} ${y(pts[i - 1].price).toFixed(1)}`;
            d += ` L ${x(pts[i].t).toFixed(1)} ${y(pts[i].price).toFixed(1)}`;
        }
        d += ` L ${x(maxT).toFixed(1)} ${y(pts[pts.length - 1].price).toFixed(1)}`;

        const yTicks = [minP, (minP + maxP) / 2, maxP].map((p) => ({ p, y: y(p) }));
        const xTickCount = 5;
        const xTicks = Array.from({ length: xTickCount }, (_, i) => {
            const t = minT + (i / (xTickCount - 1)) * (maxT - minT);
            return { t, x: x(t) };
        });

        return { x, y, invX, pts, path: d, yTicks, xTicks };
    }, [rangeIdx, points]);

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

    if (!fuel || !hasAny || !geo) {
        return (
            <p className={styles.empty}>
                Aún no hay suficiente histórico para mostrar la evolución. Lo registramos a diario y
                aquí verás cómo cambia el precio con el tiempo.
            </p>
        );
    }

    const mainAvailable = MAIN_FUELS.filter((f) => available.includes(f));
    const otherAvailable = OTHER_FUELS.filter((f) => available.includes(f));
    const hoverDate = hover ? dateLong.format(new Date(hover.t)) : "";
    const hoverValue = hover ? valueAt(geo.pts, hover.t) : null;

    return (
        <div className={styles.wrap}>
            {(mainAvailable.length > 0 || otherAvailable.length > 0) && (
                <div className={styles.fuelRow}>
                    <div className={styles.fuelSelector}>
                        {mainAvailable.map((f) => (
                            <button
                                key={f}
                                className={`${styles.fuelOption} ${fuel === f ? styles.active : ""}`}
                                onClick={() => setSelectedFuel(f)}
                            >
                                {FUEL_LABELS[f]}
                            </button>
                        ))}
                    </div>
                    {otherAvailable.length > 0 && (
                        <select
                            className={`${styles.fuelSelect} ${otherAvailable.includes(fuel) ? styles.fuelSelectActive : ""}`}
                            value={otherAvailable.includes(fuel) ? fuel : ""}
                            onChange={(e) => e.target.value && setSelectedFuel(e.target.value as FuelType)}
                            title="Otros carburantes"
                            aria-label="Otros carburantes"
                        >
                            <option value="">Otros…</option>
                            {otherAvailable.map((f) => (
                                <option key={f} value={f}>
                                    {FUEL_LABELS[f]}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            )}

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
                    aria-label={`Evolución del precio: ${FUEL_LABELS[fuel]}`}
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

                    {/* Línea */}
                    <path d={geo.path} fill="none" stroke={LINE_COLOR} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

                    {/* Guía + punto del hover */}
                    {hover && (
                        <g>
                            <line x1={hover.x} y1={M.t} x2={hover.x} y2={H - M.b} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" />
                            {hoverValue != null && (
                                <circle cx={hover.x} cy={geo.y(hoverValue)} r={4} fill={LINE_COLOR} stroke="var(--surface)" strokeWidth={2} />
                            )}
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
                        <div className={styles.ttRow}>
                            <span className={styles.ttDot} style={{ background: LINE_COLOR }} />
                            {FUEL_LABELS[fuel]}: <b>{hoverValue != null ? `${fmtPrice(hoverValue)} €/L` : "—"}</b>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceHistoryChart;
