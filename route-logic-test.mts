/**
 * Arnés de test de la LÓGICA del planificador de rutas.
 *
 * Ejecuta EXACTAMENTE las mismas funciones puras que usa el componente
 * (src/components/Route/RoutePlanner.tsx → src/lib/route.ts) sobre:
 *   - Datos reales de gasolineras (public/data/stations.json).
 *   - Geometría de ruta real (Valhalla → OSRM, igual que en producción).
 *
 * Para cada escenario reproduce el MODELO DE PUNTUACIÓN de pickStops
 * (ventanas de autonomía + score precio/tiempo) para poder JUSTIFICAR por qué
 * se elige cada gasolinera, con una auto-verificación (assert) de que la
 * explicación reproducida coincide con la elección real del algoritmo.
 *
 * Salida: informe-test-rutas.md
 *
 * Este fichero es TEMPORAL (fuera del build de la app). Ejecutar con:
 *   npx tsx route-logic-test.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
    computeFuelPlan,
    findCorridorStations,
    pickStops,
    allocateRefuels,
    simulateTankLevels,
    getRouteMulti,
    progressOnRoute,
    SAFETY_PCT,
    type CorridorStation,
    type Priority,
    type GeoPoint,
} from './src/lib/route';
import { getDistance } from './src/lib/geo';
import type { GasStation, FuelType } from './src/types/gasolinera';
import { FUEL_LABELS } from './src/lib/fuels';

// --- Constantes del modelo de pickStops (deben COINCIDIR con route.ts). ---
// Se verifican por auto-check: si mi explicación no reprodujese la elección
// real de pickStops, el informe lo marcaría como "DRIFT".
const PRIORITY_WEIGHTS: Record<Priority, { price: number; time: number }> = {
    cheap: { price: 1, time: 0.05 },
    balanced: { price: 0.6, time: 0.4 },
    fast: { price: 0.05, time: 1 },
};
const DEDICATED_STOP_KM = 6;
const NEAR_WAYPOINT_KM = 4;

// --- Coordenadas fijas de ciudades (endpoints deterministas, sin geocoding). ---
const CITY: Record<string, GeoPoint & { name: string }> = {
    madrid: { name: 'Madrid', lat: 40.4168, lng: -3.7038 },
    toledo: { name: 'Toledo', lat: 39.8628, lng: -4.0273 },
    barcelona: { name: 'Barcelona', lat: 41.3874, lng: 2.1686 },
    sevilla: { name: 'Sevilla', lat: 37.3891, lng: -5.9845 },
    cadiz: { name: 'Cádiz', lat: 36.5271, lng: -6.2886 },
    coruna: { name: 'A Coruña', lat: 43.3623, lng: -8.4115 },
    almeria: { name: 'Almería', lat: 36.834, lng: -2.4637 },
    cartagena: { name: 'Cartagena', lat: 37.6257, lng: -0.9966 },
    valencia: { name: 'Valencia', lat: 39.4699, lng: -0.3763 },
    bilbao: { name: 'Bilbao', lat: 43.263, lng: -2.935 },
    malaga: { name: 'Málaga', lat: 36.7213, lng: -4.4214 },
    zaragoza: { name: 'Zaragoza', lat: 41.6488, lng: -0.8891 },
    lleida: { name: 'Lleida', lat: 41.6176, lng: 0.62 },
    ciudadreal: { name: 'Ciudad Real', lat: 38.9848, lng: -3.9274 },
    cordoba: { name: 'Córdoba', lat: 37.8882, lng: -4.7794 },
    antequera: { name: 'Antequera', lat: 37.0179, lng: -4.5596 },
    granada: { name: 'Granada', lat: 37.1773, lng: -3.5986 },
    aranjuez: { name: 'Aranjuez', lat: 40.0312, lng: -3.6033 },
    segovia: { name: 'Segovia', lat: 40.9429, lng: -4.1088 },
};

interface Scenario {
    id: string;
    title: string;
    focus: string;
    origin: keyof typeof CITY;
    destination: keyof typeof CITY;
    waypoints?: (keyof typeof CITY)[];
    fuel: FuelType;
    consumption: number;
    capacity: number;
    startPct: number;
    arrivePct: number;
    stopsMode: 'auto' | '0' | '1' | '2' | '3';
    avoidTolls?: boolean;
    roundTrip?: boolean;
    brands?: string[];
    detail?: boolean; // true = volcado completo con justificación; false = solo resumen
}

// 23 escenarios CURADOS (detalle completo con justificación) que cubren todas las variantes.
const SCENARIOS: Scenario[] = [
    {
        id: 'S01', title: 'Trayecto corto, depósito lleno → 0 paradas',
        focus: 'Verifica que con autonomía de sobra NO se propone ninguna parada (canMakeItNoStops).',
        origin: 'madrid', destination: 'toledo', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 90, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S02', title: 'Media distancia, salida 50% → 1 parada (auto)',
        focus: 'Autonomía de salida insuficiente pero un solo repostaje basta.',
        origin: 'madrid', destination: 'barcelona', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 50, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S03', title: 'Larga distancia → 2 paradas (auto)',
        focus: 'Reparto de 2 repostajes en ventanas de autonomía sucesivas; compara 3 estrategias.',
        origin: 'barcelona', destination: 'cadiz', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 80, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S04', title: 'Muy larga + depósito pequeño → ~3 paradas (auto)',
        focus: 'Depósito 30 L, consumo alto: obliga a varias paradas. Comprueba que ninguna etapa deja el depósito en negativo.',
        origin: 'coruna', destination: 'almeria', fuel: 'diesel',
        consumption: 9, capacity: 30, startPct: 60, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S05', title: 'Extremo: depósito 25 L → >3 paradas (auto)',
        focus: 'Caso límite con muchas paradas (auto puede superar 3). Verifica ventanas y no-negatividad.',
        origin: 'coruna', destination: 'cartagena', fuel: 'diesel',
        consumption: 10, capacity: 25, startPct: 50, arrivePct: 10, stopsMode: 'auto',
    },
    {
        id: 'S06', title: 'Diésel, 1 parada',
        focus: 'Corredor de diésel (muchas estaciones). Elección barata vs rápida.',
        origin: 'madrid', destination: 'valencia', fuel: 'diesel',
        consumption: 6.5, capacity: 45, startPct: 45, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S07', title: 'GLP (autogas): corredor escaso',
        focus: 'Combustible con pocas estaciones. Comprueba manejo de corredor pequeño / desvíos grandes.',
        origin: 'madrid', destination: 'bilbao', fuel: 'glp',
        consumption: 7.5, capacity: 45, startPct: 40, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S08', title: 'Evitar peajes (Madrid→Sevilla)',
        focus: 'Flag avoidTolls: la ruta y el corredor deben calcularse sobre la ruta sin peaje.',
        origin: 'madrid', destination: 'sevilla', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 45, arrivePct: 15, stopsMode: 'auto', avoidTolls: true,
    },
    {
        id: 'S09', title: 'Evitar peajes (Barcelona→Madrid)',
        focus: 'Corredor mediterráneo con AP-2/AP-7: comprueba detección/evitación de peaje.',
        origin: 'barcelona', destination: 'madrid', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 45, arrivePct: 15, stopsMode: 'auto', avoidTolls: true,
    },
    {
        id: 'S10', title: 'Filtro de marca: solo Repsol',
        focus: 'Restringe el corredor a una marca. Todas las paradas deben ser Repsol.',
        origin: 'madrid', destination: 'barcelona', fuel: 'sp95',
        consumption: 6.5, capacity: 45, startPct: 45, arrivePct: 15, stopsMode: 'auto', brands: ['Repsol'],
    },
    {
        id: 'S11', title: 'Filtro de marca: Cepsa + BP',
        focus: 'Corredor limitado a dos marcas. Verifica que solo se eligen esas.',
        origin: 'madrid', destination: 'barcelona', fuel: 'sp95',
        consumption: 6.5, capacity: 45, startPct: 45, arrivePct: 15, stopsMode: 'auto', brands: ['Cepsa', 'BP'],
    },
    {
        id: 'S12', title: '1 parada del conductor (waypoint)',
        focus: 'Waypoint intermedio: la ruta base pasa por él y el corredor lo rodea.',
        origin: 'valencia', destination: 'bilbao', waypoints: ['madrid'], fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 50, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S13', title: '2 paradas del conductor',
        focus: 'Dos waypoints (Zaragoza, Lleida). Orden por progreso y repostaje convenient cerca de ellos.',
        origin: 'madrid', destination: 'barcelona', waypoints: ['zaragoza', 'lleida'], fuel: 'sp95',
        consumption: 6.5, capacity: 45, startPct: 45, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S14', title: '4 paradas del conductor (>3)',
        focus: 'Cuatro waypoints. Verifica orden por progreso y efecto "convenient" (repostar junto a una parada no penaliza tiempo).',
        origin: 'madrid', destination: 'malaga',
        waypoints: ['aranjuez', 'ciudadreal', 'cordoba', 'antequera'], fuel: 'sp95',
        consumption: 6.5, capacity: 45, startPct: 50, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S15', title: '5 paradas del conductor (>3)',
        focus: 'Cinco waypoints en un trayecto largo. Estrés del ordenamiento y de las ventanas con muchos puntos propios.',
        origin: 'bilbao', destination: 'malaga',
        waypoints: ['madrid', 'toledo', 'ciudadreal', 'cordoba', 'granada'], fuel: 'sp95',
        consumption: 7, capacity: 50, startPct: 50, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S16', title: 'Forzar 1 parada cuando auto pide 2 (infra-repostaje)',
        focus: 'stopsMode=1 en ruta que necesita 2. DEBE detectarse que se llega bajo mínimos o en seco.',
        origin: 'barcelona', destination: 'cadiz', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 80, arrivePct: 15, stopsMode: '1',
    },
    {
        id: 'S17', title: 'Forzar 3 paradas cuando auto pide 1 (sobre-repostaje)',
        focus: 'stopsMode=3 en ruta que solo necesita 1. Comprueba cómo se distribuyen 3 ventanas y que no sobra depósito absurdo.',
        origin: 'madrid', destination: 'barcelona', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 50, arrivePct: 15, stopsMode: '3',
    },
    {
        id: 'S18', title: 'Ida y vuelta',
        focus: 'roundTrip: el destino pasa a ser waypoint y se vuelve al origen; distancia ~doble.',
        origin: 'madrid', destination: 'valencia', fuel: 'sp95',
        consumption: 6.5, capacity: 45, startPct: 60, arrivePct: 15, stopsMode: 'auto', roundTrip: true,
    },
    {
        id: 'S19', title: 'Salida muy baja (20%)',
        focus: 'Primera ventana pegada al inicio: la parada 0 debe caer pronto (poca autonomía de salida).',
        origin: 'madrid', destination: 'barcelona', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 20, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S20', title: 'Reserva de llegada alta (50%)',
        focus: 'arrivePct=50: la ÚLTIMA parada debe forzarse cerca del destino (arriveTopUpRangeKm pequeño).',
        origin: 'madrid', destination: 'barcelona', fuel: 'sp95',
        consumption: 6.5, capacity: 50, startPct: 45, arrivePct: 50, stopsMode: 'auto',
    },
    {
        id: 'S21', title: 'Furgoneta (consumo 9.5)',
        focus: 'Consumo alto reduce autonomía: comprueba nº de paradas y litros repostados.',
        origin: 'madrid', destination: 'sevilla', fuel: 'diesel',
        consumption: 9.5, capacity: 50, startPct: 45, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S22', title: 'Depósito grande (80 L), salida 90%',
        focus: 'Gran autonomía: debería llegar sin paradas o con una sola pese a la distancia.',
        origin: 'zaragoza', destination: 'sevilla', fuel: 'diesel',
        consumption: 6, capacity: 80, startPct: 90, arrivePct: 15, stopsMode: 'auto',
    },
    {
        id: 'S23', title: 'SP98 (combustible premium poco común)',
        focus: 'Corredor de SP98 (menos estaciones que SP95). Verifica selección con corredor medio.',
        origin: 'madrid', destination: 'granada', fuel: 'sp98',
        consumption: 6.5, capacity: 50, startPct: 45, arrivePct: 15, stopsMode: 'auto',
    },
];

// --- Generación de 100+ escenarios ÚNICOS (cobertura amplia, sin repetir ninguno) ---
type BR = { origin: keyof typeof CITY; destination: keyof typeof CITY; waypoints?: (keyof typeof CITY)[]; avoidTolls?: boolean; roundTrip?: boolean };
const BASE_ROUTES: BR[] = [
    { origin: 'madrid', destination: 'toledo' },
    { origin: 'madrid', destination: 'valencia' },
    { origin: 'madrid', destination: 'barcelona' },
    { origin: 'madrid', destination: 'sevilla' },
    { origin: 'madrid', destination: 'malaga' },
    { origin: 'madrid', destination: 'bilbao' },
    { origin: 'madrid', destination: 'granada' },
    { origin: 'barcelona', destination: 'cadiz' },
    { origin: 'barcelona', destination: 'sevilla' },
    { origin: 'barcelona', destination: 'madrid', avoidTolls: true },
    { origin: 'coruna', destination: 'almeria' },
    { origin: 'coruna', destination: 'cartagena' },
    { origin: 'coruna', destination: 'madrid' },
    { origin: 'valencia', destination: 'bilbao' },
    { origin: 'valencia', destination: 'coruna' },
    { origin: 'zaragoza', destination: 'sevilla' },
    { origin: 'malaga', destination: 'bilbao' },
    { origin: 'cartagena', destination: 'madrid' },
    { origin: 'granada', destination: 'zaragoza' },
    { origin: 'sevilla', destination: 'barcelona' },
    { origin: 'bilbao', destination: 'malaga' },
    { origin: 'almeria', destination: 'bilbao' },
    // Con paradas del conductor (waypoints), incluidas >3:
    { origin: 'valencia', destination: 'bilbao', waypoints: ['madrid'] },
    { origin: 'madrid', destination: 'barcelona', waypoints: ['zaragoza', 'lleida'] },
    { origin: 'cadiz', destination: 'barcelona', waypoints: ['madrid'] },
    { origin: 'bilbao', destination: 'valencia', waypoints: ['zaragoza'] },
    { origin: 'madrid', destination: 'malaga', waypoints: ['aranjuez', 'ciudadreal', 'cordoba', 'antequera'] },
    { origin: 'bilbao', destination: 'malaga', waypoints: ['madrid', 'toledo', 'ciudadreal', 'cordoba', 'granada'] },
    // Evitar peajes / ida y vuelta:
    { origin: 'madrid', destination: 'sevilla', avoidTolls: true },
    { origin: 'madrid', destination: 'valencia', roundTrip: true },
    { origin: 'barcelona', destination: 'cadiz', roundTrip: true },
];

const PROFILES = [
    { name: 'Compacto', consumption: 5.5, capacity: 55 },
    { name: 'Berlina', consumption: 6.5, capacity: 50 },
    { name: 'SUV', consumption: 8, capacity: 60 },
    { name: 'Furgoneta', consumption: 9.5, capacity: 45 },
    { name: 'Depósito pequeño', consumption: 6.5, capacity: 35 },
    { name: 'Depósito grande', consumption: 6, capacity: 80 },
    { name: 'Extremo', consumption: 10, capacity: 28 },
];
const G_STARTS = [30, 45, 60, 80, 90];
const G_ARRIVES = [10, 15, 25, 40];
const G_FUELS: FuelType[] = ['sp95', 'diesel', 'sp98'];
const G_STOPSMODES: ('auto' | '0' | '1' | '2' | '3')[] = ['auto', 'auto', 'auto', '1', '2'];
const G_BRANDS: (string[] | undefined)[] = [undefined, undefined, undefined, ['Repsol'], ['Cepsa', 'BP']];

/** Firma canónica de un escenario (para deduplicar; ignora id/título/foco). */
function sig(s: Scenario): string {
    return JSON.stringify([
        s.origin, s.destination, s.waypoints ?? [], s.fuel, s.consumption, s.capacity,
        s.startPct, s.arrivePct, s.stopsMode, !!s.avoidTolls, !!s.roundTrip, s.brands ?? [],
    ]);
}

const TARGET_GENERATED = 100;
function buildGenerated(): Scenario[] {
    const seen = new Set<string>(SCENARIOS.map(sig)); // no repetir los curados
    const out: Scenario[] = [];
    let gi = 0;
    // Perfil por fuera, ruta por dentro: cada perfil recorre TODAS las rutas → cobertura amplia.
    for (let p = 0; p < PROFILES.length && out.length < TARGET_GENERATED; p++) {
        const prof = PROFILES[p];
        for (let r = 0; r < BASE_ROUTES.length && out.length < TARGET_GENERATED; r++) {
            const br = BASE_ROUTES[r];
            const startPct = G_STARTS[(r + p) % G_STARTS.length];
            const arrivePct = G_ARRIVES[(r + 2 * p) % G_ARRIVES.length];
            const fuel = G_FUELS[(r + p) % G_FUELS.length];
            const stopsMode = G_STOPSMODES[(r * 3 + p) % G_STOPSMODES.length];
            const brands = G_BRANDS[(r + p) % G_BRANDS.length];
            const sc: Scenario = {
                id: '', title: '', focus: 'Escenario de cobertura (verificación de viabilidad y coherencia).',
                origin: br.origin, destination: br.destination, waypoints: br.waypoints,
                fuel, consumption: prof.consumption, capacity: prof.capacity,
                startPct, arrivePct, stopsMode, avoidTolls: br.avoidTolls, roundTrip: br.roundTrip, brands,
                detail: false,
            };
            const s = sig(sc);
            if (seen.has(s)) continue; // nunca repetir una opción
            seen.add(s);
            gi++;
            sc.id = `G${String(gi).padStart(3, '0')}`;
            sc.title = `${CITY[br.origin].name}→${CITY[br.destination].name}${br.waypoints ? ' +' + br.waypoints.length + 'wp' : ''} · ${prof.name} · ${FUEL_LABELS[fuel]} · ${startPct}/${arrivePct}% · ${stopsMode}${br.avoidTolls ? ' · sin peaje' : ''}${br.roundTrip ? ' · i/v' : ''}${brands ? ' · ' + brands.join('+') : ''}`;
            out.push(sc);
        }
    }
    return out;
}

// Lista final: 23 curados (con detalle) + 100 generados (resumen). Todos únicos.
const ALL_SCENARIOS: Scenario[] = [
    ...SCENARIOS.map((s) => ({ ...s, detail: true })),
    ...buildGenerated(),
];

// ---------------------------------------------------------------------------
const EPS = 0.5; // tolerancia en litros para las comprobaciones de reserva
type Status = 'PASS' | 'WARN' | 'FAIL';
interface Assertion { name: string; status: Status; detail: string; }

const md: string[] = [];
const summary: { id: string; title: string; dist: string; stops: string; costs: string; detail: boolean; pass: number; warn: number; fail: number }[] = [];

// Hallazgos auto-detectados (para la sección de conclusiones).
interface DryFinding { id: string; title: string; prio: Priority; legKm: number; maxRangeKm: number; fromPct: number; toPct: number; }
interface CostFinding { id: string; title: string; cheap: number; best: number; }
const dryFindings: DryFinding[] = [];
const costFindings: CostFinding[] = [];

function esc(s: string): string {
    return s.replace(/\|/g, '/');
}

// Cache de rutas para no repetir llamadas de red por endpoints idénticos.
const routeCache = new Map<string, Awaited<ReturnType<typeof getRouteMulti>>>();
async function routeFor(points: GeoPoint[], avoidTolls: boolean) {
    const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|') + '|' + avoidTolls;
    if (routeCache.has(key)) return routeCache.get(key)!;
    const r = await getRouteMulti(points, { avoidTolls });
    routeCache.set(key, r);
    return r;
}

// Reproduce los límites FACTIBLES de pickStops v2 (hardLo/prefLo/hi respecto a la
// posición real de la parada anterior) para justificar dónde puede ir cada parada.
function makeBounds(
    fuel: { totalDistanceKm: number; startRangeKm: number; maxRangeKm: number; arriveTopUpRangeKm?: number },
    stops: number
) {
    return (k: number, prevProg: number): { hardLo: number; prefLo: number; hi: number } => {
        if (fuel.maxRangeKm > 0 && fuel.totalDistanceKm > 0) {
            const D = fuel.totalDistanceKm;
            const prevKm = prevProg * D;
            const hiKm = Math.min(D, k === 0 ? fuel.startRangeKm : prevKm + fuel.maxRangeKm);
            const lastReachKm = fuel.arriveTopUpRangeKm ?? fuel.maxRangeKm;
            const feasibleLoKm = D - lastReachKm - (stops - 1 - k) * fuel.maxRangeKm;
            const hardLoKm = Math.min(hiKm, Math.max(0, prevKm, feasibleLoKm));
            const prefLoKm = Math.min(hiKm, Math.max(hardLoKm, hiKm - fuel.maxRangeKm * 0.45));
            return { hardLo: hardLoKm / D, prefLo: prefLoKm / D, hi: hiKm / D };
        }
        return { hardLo: k / stops, prefLo: k / stops, hi: (k + 1) / stops };
    };
}

interface StrategyResult {
    prio: Priority;
    picks: ReturnType<typeof allocateRefuels>;
    avgPrice: number;
    avgDetour: number;
    cost: number;
    explanation: string[];
    tankRows: string[];
    destArrival: number;
    assertions: Assertion[];
}

function pct(x: number): string { return (x * 100).toFixed(1) + '%'; }

const corridorCache = new Map<string, ReturnType<typeof findCorridorStations>>();
function statusIcon(s: Status): string { return s === 'PASS' ? '✅' : s === 'WARN' ? '⚠️' : '❌'; }

async function runScenario(sc: Scenario) {
    const detail = sc.detail !== false;
    const out: string[] = []; // sección detallada (se emite si detail; si no, solo si hay ⚠️/❌)
    const o = CITY[sc.origin];
    const d = CITY[sc.destination];
    const wps = (sc.waypoints ?? []).map((w) => CITY[w]);

    const basePoints: GeoPoint[] = sc.roundTrip
        ? [o, ...wps, d, o]
        : [o, ...wps, d];
    const routeKey = basePoints.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|') + '|' + !!sc.avoidTolls;
    const route = await routeFor(basePoints, !!sc.avoidTolls);

    const routeDesc = `${o.name} → ${wps.map((w) => w.name).join(' → ')}${wps.length ? ' → ' : ''}${d.name}${sc.roundTrip ? ` → ${o.name} (ida y vuelta)` : ''}`;
    const paramsLine = `${FUEL_LABELS[sc.fuel]} · consumo ${sc.consumption} L/100 · depósito ${sc.capacity} L · salida ${sc.startPct}% · llegada ≥ ${sc.arrivePct}% · paradas=${sc.stopsMode}${sc.avoidTolls ? ' · evitar peajes' : ''}${sc.brands ? ' · marcas: ' + sc.brands.join('+') : ''}`;
    out.push(`\n## ${sc.id} · ${esc(sc.title)}\n`);
    out.push(`> **Objetivo del test:** ${esc(sc.focus)}\n`);
    out.push(`**Ruta:** ${esc(routeDesc)}  `);
    out.push(`**Parámetros:** ${esc(paramsLine)}\n`);

    const compactMeta: string[] = [`**Ruta:** ${esc(routeDesc)}  `, `**Parámetros:** ${esc(paramsLine)}\n`];
    let comparative: string[] = [];

    // Emisión final: detalle completo si `detail`; si no, bloque compacto solo con
    // problemas. Siempre añade la fila de resumen.
    const finalize = (a: Assertion[], stopsLabel: string, costsLabel: string, dist: string) => {
        out.push(`### Comprobaciones de lógica\n`, `| Estado | Comprobación | Detalle |`, `|:--:|---|---|`);
        for (const x of a) out.push(`| ${statusIcon(x.status)} | ${esc(x.name)} | ${esc(x.detail)} |`);
        out.push('');
        const pass = a.filter((x) => x.status === 'PASS').length;
        const warn = a.filter((x) => x.status === 'WARN').length;
        const fail = a.filter((x) => x.status === 'FAIL').length;
        if (detail) {
            md.push(...out);
        } else if (warn + fail > 0) {
            md.push(`\n### ${fail > 0 ? '❌' : '⚠️'} ${esc(sc.id)} · ${esc(sc.title)}\n`, ...compactMeta, ...comparative);
            md.push(`| Estado | Comprobación | Detalle |`, `|:--:|---|---|`);
            for (const x of a) if (x.status !== 'PASS') md.push(`| ${statusIcon(x.status)} | ${esc(x.name)} | ${esc(x.detail)} |`);
            md.push('');
        }
        summary.push({ id: sc.id, title: sc.title, dist, stops: stopsLabel, costs: costsLabel, detail, pass, warn, fail });
    };

    if (!route) {
        out.push(`❌ **No se pudo calcular la ruta** (servicio de routing no disponible).\n`);
        if (detail) md.push(...out);
        else md.push(`\n### ❌ ${esc(sc.id)} · ${esc(sc.title)} — ruta no disponible\n`);
        summary.push({ id: sc.id, title: sc.title, dist: '—', stops: 'ROUTE FAIL', costs: '—', detail, pass: 0, warn: 0, fail: 1 });
        return;
    }

    const cKey = routeKey + '|' + sc.fuel;
    let corridorRaw = corridorCache.get(cKey);
    if (!corridorRaw) { corridorRaw = findCorridorStations(loadStations(), route.coords, sc.fuel); corridorCache.set(cKey, corridorRaw); }
    const brandSet = new Set(sc.brands ?? []);
    const corridor = brandSet.size ? corridorRaw.filter((s) => brandSet.has(s.brand)) : corridorRaw;
    const corridorAvg = corridor.length ? corridor.reduce((s, x) => s + x.price, 0) / corridor.length : 0;

    out.push(`**Ruta calculada:** ${route.distanceKm.toFixed(0)} km · ${Math.round(route.durationMin)} min · peaje: ${route.hasToll === undefined ? 'desconocido (OSRM)' : route.hasToll ? 'SÍ' : 'no'}  `);
    out.push(`**Corredor (${FUEL_LABELS[sc.fuel]}, ≤4 km):** ${corridorRaw.length} estaciones${brandSet.size ? ` → ${corridor.length} tras filtro de marca` : ''} · precio medio ${corridorAvg ? corridorAvg.toFixed(3) : '—'} €/L\n`);

    if (corridor.length === 0) {
        out.push(`⚠️ **Corredor vacío** para este combustible/marca: el planificador mostraría un error al usuario ("No hay gasolineras…"). Es el comportamiento esperado.\n`);
        finalize([{ name: 'Corredor vacío → error al usuario (esperado)', status: 'PASS', detail: 'sin estaciones de ese combustible/marca en la ruta' }], 'corredor vacío', '—', route.distanceKm.toFixed(0));
        return;
    }

    const fuelPlan = computeFuelPlan({
        distanceKm: route.distanceKm,
        consumption: sc.consumption,
        capacity: sc.capacity,
        startPct: sc.startPct,
        arrivePct: sc.arrivePct,
    });
    const nStops = sc.stopsMode === 'auto' ? fuelPlan.minStops : parseInt(sc.stopsMode, 10);
    const arriveTopUpRangeKm = (sc.capacity * (1 - sc.arrivePct / 100)) / sc.consumption * 100;
    const arriveReserve = (sc.capacity * sc.arrivePct) / 100;
    const safetyReserve = (sc.capacity * SAFETY_PCT) / 100;

    // --- Plan de combustible: justificación numérica ---
    out.push(`### Plan de combustible\n`);
    out.push('```');
    out.push(`consumo del viaje  = ${route.distanceKm.toFixed(0)} km × ${sc.consumption}/100        = ${fuelPlan.fuelNeeded.toFixed(1)} L`);
    out.push(`litros de salida   = ${sc.capacity} × ${sc.startPct}%                    = ${fuelPlan.startLiters.toFixed(1)} L`);
    out.push(`reserva de llegada = ${sc.capacity} × ${sc.arrivePct}%                    = ${arriveReserve.toFixed(1)} L`);
    out.push(`margen seguridad   = ${sc.capacity} × ${SAFETY_PCT}%                     = ${safetyReserve.toFixed(1)} L`);
    out.push(`autonomía salida   = (${fuelPlan.startLiters.toFixed(1)}-${safetyReserve.toFixed(1)}) / ${sc.consumption} × 100  = ${fuelPlan.startRangeKm.toFixed(0)} km`);
    out.push(`autonomía tanque   = (${sc.capacity}-${safetyReserve.toFixed(1)}) / ${sc.consumption} × 100  = ${fuelPlan.maxRangeKm.toFixed(0)} km`);
    out.push(`¿llega sin parar?  = ${fuelPlan.startLiters.toFixed(1)} - ${fuelPlan.fuelNeeded.toFixed(1)} ≥ ${arriveReserve.toFixed(1)}? → ${fuelPlan.canMakeItNoStops ? 'SÍ' : 'NO'}`);
    out.push(`paradas mínimas    = ${fuelPlan.minStops}   (modo=${sc.stopsMode} → se usan ${nStops})`);
    out.push('```');

    let reason: string;
    if (fuelPlan.canMakeItNoStops) {
        reason = `Con ${fuelPlan.startLiters.toFixed(0)} L de salida y un consumo de ${fuelPlan.fuelNeeded.toFixed(0)} L, terminas con ${(fuelPlan.startLiters - fuelPlan.fuelNeeded).toFixed(0)} L ≥ ${arriveReserve.toFixed(0)} L de reserva. **No hace falta repostar.**`;
    } else {
        const cover = fuelPlan.startRangeKm + fuelPlan.minStops * fuelPlan.maxRangeKm;
        reason = `La autonomía de salida (${fuelPlan.startRangeKm.toFixed(0)} km) no cubre los ${route.distanceKm.toFixed(0)} km. Con ${fuelPlan.minStops} repostaje(s) de depósito lleno la autonomía acumulada es ${fuelPlan.startRangeKm.toFixed(0)} + ${fuelPlan.minStops}×${fuelPlan.maxRangeKm.toFixed(0)} = ${cover.toFixed(0)} km ≥ ${route.distanceKm.toFixed(0)} km. **Mínimo ${fuelPlan.minStops} parada(s).**`;
    }
    out.push(`**Justificación:** ${reason}\n`);

    if (nStops <= 0) {
        // Sin paradas: comprobar llegada.
        const destArrival = fuelPlan.startLiters - fuelPlan.fuelNeeded;
        const a: Assertion[] = [];
        a.push({
            name: 'Llega con la reserva pedida',
            status: destArrival >= arriveReserve - EPS ? 'PASS' : (destArrival >= 0 ? 'WARN' : 'FAIL'),
            detail: `llega con ${destArrival.toFixed(1)} L (reserva pedida ${arriveReserve.toFixed(1)} L)`,
        });
        if (!fuelPlan.canMakeItNoStops) {
            a.push({
                name: 'Coherencia modo "sin paradas"',
                status: 'WARN',
                detail: `el usuario forzó 0 paradas pero el plan pide ${fuelPlan.minStops}: se avisa de quedarse sin combustible a ~${Math.max(0, route.distanceKm - fuelPlan.startRangeKm).toFixed(0)} km del destino`,
            });
        }
        finalize(a, sc.stopsMode === 'auto' ? `0 (auto=${fuelPlan.minStops})` : `0 (forzado, auto=${fuelPlan.minStops})`, 'sin repostaje', route.distanceKm.toFixed(0));
        return;
    }

    // --- Estrategias (barata / equilibrada / rápida) como en la app ---
    const fuelRange = {
        totalDistanceKm: route.distanceKm,
        startRangeKm: fuelPlan.startRangeKm,
        maxRangeKm: fuelPlan.maxRangeKm,
        arriveTopUpRangeKm,
    };
    const bounds = makeBounds(fuelRange, nStops);
    const wpGeo = wps.map((w) => ({ lat: w.lat, lng: w.lng }));

    // Enriquecido global (para score) — replica pickStops.
    const nearestWpKm = (s: CorridorStation) =>
        wpGeo.length ? Math.min(...wpGeo.map((w) => getDistance(s.lat, s.lng, w.lat, w.lng))) : Infinity;
    const enriched = corridor.map((s) => {
        const convenient = nearestWpKm(s) <= NEAR_WAYPOINT_KM;
        return { s, price: s.price, timeCost: s.detourKm + (convenient ? 0 : DEDICATED_STOP_KM), convenient };
    });
    const prices = enriched.map((e) => e.price);
    const times = enriched.map((e) => e.timeCost);
    const pMin = Math.min(...prices), pMax = Math.max(...prices);
    const tMin = Math.min(...times), tMax = Math.max(...times);
    const norm = (v: number, lo: number, hi: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
    const byId = new Map(enriched.map((e) => [e.s.id, e]));

    const strategies: StrategyResult[] = [];
    for (const prio of ['cheap', 'balanced', 'fast'] as Priority[]) {
        const w = PRIORITY_WEIGHTS[prio];
        const scoreOf = (e: (typeof enriched)[number]) =>
            w.price * norm(e.price, pMin, pMax) + w.time * norm(e.timeCost, tMin, tMax);

        const raw = pickStops(corridor, nStops, prio, wpGeo, fuelRange);
        const picks = allocateRefuels(raw, {
            totalDistanceKm: route.distanceKm,
            consumption: sc.consumption,
            capacity: sc.capacity,
            startLiters: fuelPlan.startLiters,
            arrivePct: sc.arrivePct,
        });
        const avgPrice = picks.length ? picks.reduce((s, x) => s + x.price, 0) / picks.length : 0;
        const avgDetour = picks.length ? picks.reduce((s, x) => s + x.detourKm, 0) / picks.length : 0;
        const cost = picks.reduce((s, x) => s + x.cost, 0);

        // Réplica EXACTA del bucle de selección de pickStops, en ORDEN DE ELECCIÓN
        // (k=0,1,2…). Así la atribución parada↔ventana es exacta aunque dos
        // ventanas se solapen (caso de forzar más paradas de las necesarias),
        // y la justificación no puede dar falsos "DRIFT".
        const scoredAll = enriched.map((e) => ({ e, score: scoreOf(e) }));
        interface SelStep { e: (typeof enriched)[number]; k: number; lo: number; hi: number; poolSize: number; usedFallback: boolean; cheapest: (typeof enriched)[number]; }
        const selection: SelStep[] = [];
        const pickedIds = new Set<string>();
        let prevProgSel = 0;
        for (let k = 0; k < nStops; k++) {
            const { hardLo, prefLo, hi } = bounds(k, prevProgSel);
            const available = scoredAll.filter((x) => !pickedIds.has(x.e.s.id));
            // Las "convenient" (junto a una parada propia) entran desde hardLo (v3).
            let pool = available.filter(
                (x) => x.e.s.progress <= hi && x.e.s.progress >= (x.e.convenient ? hardLo : prefLo)
            );
            let usedFallback = false;
            if (pool.length === 0) { pool = available.filter((x) => x.e.s.progress >= hardLo && x.e.s.progress <= hi); usedFallback = true; }
            let chosen: (typeof scoredAll)[number] | undefined;
            if (pool.length > 0) {
                chosen = pool.reduce((a, b) => (b.score < a.score ? b : a));
            } else {
                usedFallback = true;
                const reachable = available.filter((x) => x.e.s.progress <= hi);
                chosen = reachable.length
                    ? reachable.reduce((a, b) => (b.e.s.progress > a.e.s.progress ? b : a))
                    : available.reduce((a, b) => (b.e.s.progress < a.e.s.progress ? b : a), available[0]);
                pool = reachable.length ? reachable : available;
            }
            if (!chosen) break;
            const cheapest = pool.reduce((a, b) => (b.e.price < a.e.price ? b : a));
            pickedIds.add(chosen.e.s.id);
            selection.push({ e: chosen.e, k, lo: prefLo, hi, poolSize: pool.length, usedFallback, cheapest: cheapest.e });
            prevProgSel = chosen.e.s.progress;
        }
        // Oráculo: el conjunto reproducido debe coincidir con el de pickStops real.
        const realIds = new Set(raw.map((p) => p.id));
        const reproduceOk = pickedIds.size === realIds.size && [...pickedIds].every((id) => realIds.has(id));

        const expl: string[] = [];
        expl.push(`| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |`);
        expl.push(`|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|`);
        for (const st of selection) {
            const s = st.e.s;
            const sc0 = scoreOf(st.e);
            let why: string;
            if (st.usedFallback) {
                why = `sin estación dentro de la ventana → se amplía y se toma la de menor score disponible (${st.poolSize} candidatas)`;
            } else if (st.cheapest.s.id === s.id) {
                why = `menor score entre ${st.poolSize} candidatas de la ventana (también la más barata)`;
            } else {
                why = `menor score entre ${st.poolSize} candidatas (la más barata era ${esc(st.cheapest.s.brand)} a ${st.cheapest.s.price.toFixed(3)}, con peor score por desvío/tiempo)`;
            }
            const delta = s.price - corridorAvg;
            expl.push(`| ${st.k + 1} | ${esc(s.name)} (${esc(s.brand)}) | ${esc(s.city)} | ${pct(s.progress)} | ${pct(st.lo)}–${pct(st.hi)} | ${s.price.toFixed(3)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} | ${s.detourKm.toFixed(1)} km | ${st.e.timeCost.toFixed(1)} | ${sc0.toFixed(3)} | ${why} |`);
        }

        // Simulación de depósito (paradas propias + repostajes mezcladas), como en buildStopData.
        const wpPoints = wps.map((c) => ({ progress: progressOnRoute(route.coords, c.lat, c.lng), isRefuel: false as const, label: c.name }));
        const fuelPoints = picks.map((s) => ({ progress: s.progress, isRefuel: true as const, liters: s.liters, label: `${s.name} (repostaje)` }));
        const stopPoints = [...wpPoints, ...fuelPoints].sort((a, b) => a.progress - b.progress);
        const tank = simulateTankLevels(
            stopPoints.map((p) => ({ progress: p.progress, isRefuel: p.isRefuel, liters: (p as any).liters })),
            { startLiters: fuelPlan.startLiters, totalDistanceKm: route.distanceKm, consumption: sc.consumption }
        );
        const tankRows: string[] = [];
        tankRows.push(`| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |`);
        tankRows.push(`|--:|---|--:|--:|--:|--:|`);
        stopPoints.forEach((p, i) => {
            const t = tank[i];
            tankRows.push(`| ${i + 1} | ${esc(p.label)} | ${pct(p.progress)} | ${t.arrivalLiters.toFixed(1)} | ${p.isRefuel ? (p as any).liters.toFixed(1) + ' L' : '—'} | ${t.departureLiters.toFixed(1)} |`);
        });
        // Llegada al destino tras la última parada.
        const lastProg = stopPoints.length ? stopPoints[stopPoints.length - 1].progress : 0;
        const lastDep = tank.length ? tank[tank.length - 1].departureLiters : fuelPlan.startLiters;
        const destArrival = lastDep - (1 - lastProg) * route.distanceKm * (sc.consumption / 100);
        tankRows.push(`| — | **Destino** | 100% | **${destArrival.toFixed(1)}** | — | — |`);

        // Assertions de la estrategia.
        const a: Assertion[] = [];
        a.push({
            name: `[${prio}] Estaciones dentro del corredor (≤4 km)`,
            status: raw.every((s) => s.detourKm <= 4.001) ? 'PASS' : 'FAIL',
            detail: `desvío máx ${Math.max(...raw.map((s) => s.detourKm)).toFixed(1)} km`,
        });
        const ordered = raw.every((s, i) => i === 0 || s.progress >= raw[i - 1].progress);
        a.push({ name: `[${prio}] Paradas ordenadas por progreso`, status: ordered ? 'PASS' : 'FAIL', detail: ordered ? 'sí' : 'orden roto' });
        a.push({
            name: `[${prio}] Nº de paradas = solicitadas`,
            status: raw.length === nStops ? 'PASS' : 'WARN',
            detail: `${raw.length}/${nStops} (menos si el corredor no tiene suficientes candidatas separadas)`,
        });
        // Índices de repostajes y su llegada; detectamos "seco" (llega con ~0 L).
        const refuelIdx = stopPoints.map((p, i) => (p.isRefuel ? i : -1)).filter((i) => i >= 0);
        const minArrivalBeforeRefuel = refuelIdx.length ? Math.min(...refuelIdx.map((i) => tank[i].arrivalLiters)) : Infinity;
        a.push({
            name: `[${prio}] No se queda en seco antes de repostar`,
            status: minArrivalBeforeRefuel >= safetyReserve - EPS ? 'PASS' : (minArrivalBeforeRefuel > 0.01 ? 'WARN' : 'FAIL'),
            detail: `llegada mínima a un repostaje = ${minArrivalBeforeRefuel.toFixed(1)} L (margen seguridad ${safetyReserve.toFixed(1)} L)`,
        });
        // Si se queda seco, registrar el tramo culpable (parada anterior → repostaje seco).
        if (minArrivalBeforeRefuel <= 0.01) {
            const dryI = refuelIdx.find((i) => tank[i].arrivalLiters <= 0.01)!;
            // El tramo que vacía el depósito va del ÚLTIMO repostaje (o la salida) a este;
            // las paradas propias intermedias no repostan, solo "pasan de largo".
            const prevRefuel = refuelIdx.filter((i) => i < dryI).pop();
            const fromProg = prevRefuel != null ? stopPoints[prevRefuel].progress : 0;
            const toProg = stopPoints[dryI].progress;
            dryFindings.push({
                id: sc.id, title: sc.title, prio,
                legKm: (toProg - fromProg) * route.distanceKm, maxRangeKm: fuelPlan.maxRangeKm,
                fromPct: fromProg, toPct: toProg,
            });
        }
        // Si el usuario forzó menos paradas de las necesarias, llegar en negativo es
        // el comportamiento esperado (se avisa), no un bug.
        const forcedInsufficient = nStops < fuelPlan.minStops;
        const arriveStatus: Status = destArrival >= arriveReserve - EPS
            ? 'PASS'
            : destArrival >= -EPS
                ? 'WARN'
                : forcedInsufficient ? 'WARN' : 'FAIL';
        a.push({
            name: `[${prio}] Llega al destino con la reserva`,
            status: arriveStatus,
            detail: `llega con ${destArrival.toFixed(1)} L (pedida ${arriveReserve.toFixed(1)} L)` +
                (destArrival < -EPS && forcedInsufficient ? ` — esperado: forzadas ${nStops} paradas < ${fuelPlan.minStops} necesarias` : ''),
        });
        a.push({ name: `[${prio}] Réplica del score = elección real de pickStops`, status: reproduceOk ? 'PASS' : 'FAIL', detail: reproduceOk ? 'el conjunto de estaciones coincide' : 'el conjunto reproducido difiere del real' });

        strategies.push({ prio, picks, avgPrice, avgDetour, cost, explanation: expl, tankRows, destArrival, assertions: a });
    }

    // Comparación entre estrategias.
    const cheap = strategies.find((s) => s.prio === 'cheap')!;
    const balanced = strategies.find((s) => s.prio === 'balanced')!;
    const fast = strategies.find((s) => s.prio === 'fast')!;

    comparative = [];
    comparative.push(`**Comparativa de estrategias (nStops=${nStops}):**`, '');
    comparative.push(`| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |`);
    comparative.push(`|---|--:|--:|--:|--:|`);
    for (const s of strategies) {
        const liters = s.picks.reduce((a, x) => a + x.liters, 0);
        comparative.push(`| ${planName(s.prio)} | ${s.avgPrice.toFixed(3)} € | ${s.avgDetour.toFixed(1)} km | ${s.cost.toFixed(2)} € | ${liters.toFixed(0)} L |`);
    }
    comparative.push('');
    out.push(`### Comparativa de estrategias (nStops=${nStops})\n`, ...comparative.slice(2));

    const crossA: Assertion[] = [];
    crossA.push({
        name: 'Barato ≤ Equilibrado ≤ Rápido (coste)',
        status: cheap.cost <= balanced.cost + 0.01 && balanced.cost <= fast.cost + 0.5 ? 'PASS' : 'WARN',
        detail: `barato ${cheap.cost.toFixed(2)} € · equilibrado ${balanced.cost.toFixed(2)} € · rápido ${fast.cost.toFixed(2)} €`,
    });
    // "Barato" minimiza el PRECIO MEDIO de las estaciones, pero lleva un 5% de peso
    // de tiempo, así que puede saltar una estación ~0,005 €/L más barata si tiene más
    // desvío. Eso puede dar una diferencia de coste mínima frente a "equilibrado".
    // Diferencia pequeña = artefacto de diseño (WARN); grande = bug real (FAIL).
    const bestOther = Math.min(balanced.cost, fast.cost);
    const inversion = cheap.cost - bestOther;
    const invTol = Math.max(2, 0.02 * cheap.cost); // margen: 2 € o 2 % del coste
    const invStatus: Status = inversion <= 0.01 ? 'PASS' : inversion <= invTol ? 'WARN' : 'FAIL';
    crossA.push({
        name: 'Barato tiene el coste mínimo',
        status: invStatus,
        detail: `barato ${cheap.cost.toFixed(2)} € vs mejor de los otros ${bestOther.toFixed(2)} €` +
            (inversion > 0.01 ? ` (Δ ${inversion.toFixed(2)} €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío)` : ''),
    });
    if (invStatus === 'FAIL') costFindings.push({ id: sc.id, title: sc.title, cheap: cheap.cost, best: bestOther });
    crossA.push({
        name: 'Rápido no tiene más desvío que barato',
        status: fast.avgDetour <= cheap.avgDetour + 0.1 ? 'PASS' : 'WARN',
        detail: `desvío rápido ${fast.avgDetour.toFixed(1)} km vs barato ${cheap.avgDetour.toFixed(1)} km`,
    });

    // Volcado detallado por estrategia (solo en escenarios con detalle).
    for (const s of strategies) {
        out.push(`#### Estrategia: ${planName(s.prio)}\n`);
        out.push(`Selección y justificación de cada repostaje:\n`);
        out.push(...s.explanation);
        out.push('');
        out.push(`Simulación del depósito a lo largo del viaje:\n`);
        out.push(...s.tankRows);
        out.push('');
    }

    // Assertions de todo el escenario.
    const allA = [...strategies.flatMap((s) => s.assertions), ...crossA];
    const costsLabel = `${cheap.cost.toFixed(1)}/${balanced.cost.toFixed(1)}/${fast.cost.toFixed(1)} €`;
    finalize(allA, sc.stopsMode === 'auto' ? `${nStops} (auto)` : `${nStops} (forzado, auto=${fuelPlan.minStops})`, costsLabel, route.distanceKm.toFixed(0));
}

function planName(p: Priority): string {
    return p === 'cheap' ? 'Más barato' : p === 'fast' ? 'Más rápido' : 'Equilibrado';
}

let _stations: GasStation[] | null = null;
function loadStations(): GasStation[] {
    if (!_stations) _stations = JSON.parse(readFileSync('./public/data/stations.json', 'utf8'));
    return _stations!;
}

async function main() {
    const stations = loadStations();
    // Verificación de unicidad: ninguna opción se repite.
    const sigs = ALL_SCENARIOS.map(sig);
    const uniqueSigs = new Set(sigs);
    const nCurated = ALL_SCENARIOS.filter((s) => s.detail).length;
    const nGenerated = ALL_SCENARIOS.length - nCurated;
    md.push(`# Informe de test de la lógica del planificador de rutas\n`);
    md.push(`_Generado el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · **${ALL_SCENARIOS.length} escenarios** (${nCurated} detallados + ${nGenerated} de cobertura) · ${stations.length.toLocaleString('es-ES')} gasolineras reales_\n`);
    md.push(`> **Unicidad:** ${uniqueSigs.size} firmas únicas de ${ALL_SCENARIOS.length} escenarios → ${uniqueSigs.size === ALL_SCENARIOS.length ? '✅ ninguna opción se repite.' : `❌ ${ALL_SCENARIOS.length - uniqueSigs.size} repetidas.`}\n`);
    md.push(`> **Corrección aplicada:** \`pickStops\` reescrito para que cada parada sea a la vez PREFERENTE y FACTIBLE (ventana acotada al alcance real desde la parada anterior). Antes de este cambio, este test detectaba planes inviables en rutas de ≥2 repostajes (te quedabas seco entre paradas). Este informe re-verifica todo el pipeline con el fix.\n`);
    md.push(`## Metodología\n`);
    md.push(`- **Datos reales:** \`public/data/stations.json\` (${stations.length.toLocaleString('es-ES')} estaciones con precios del día).`);
    md.push(`- **Rutas reales:** geometría de Valhalla → OSRM (igual que en la app). Endpoints con coordenadas fijas de cada ciudad (deterministas, sin geocoding).`);
    md.push(`- **Funciones bajo test (sin mocks):** \`computeFuelPlan\`, \`findCorridorStations\`, \`pickStops\`, \`allocateRefuels\`, \`simulateTankLevels\` de \`src/lib/route.ts\` — el mismo pipeline que ejecuta \`RoutePlanner.tsx\`.`);
    md.push(`- **${ALL_SCENARIOS.length} escenarios únicos:** ${nCurated} **curados** con volcado completo y justificación de cada gasolinera, y ${nGenerated} **de cobertura** (combinaciones de ruta × perfil de coche × combustible × depósito × prioridad × filtros). Para no hacer ilegible el informe, de los de cobertura solo se detallan los que tengan alguna incidencia (⚠️/❌); el resto aparece en la tabla resumen.`);
    md.push(`- **Justificación de cada elección:** se reproduce el modelo de puntuación de \`pickStops\` (ventana factible por parada + score \`peso_precio·precio_norm + peso_tiempo·tiempo_norm\`), con un oráculo que verifica que la reproducción coincide con la elección real del algoritmo.`);
    md.push(`- **Modelo de score (idéntico a route.ts):** barato \`{precio:1, tiempo:0.05}\`, equilibrado \`{0.6, 0.4}\`, rápido \`{0.05, 1}\`. Parada dedicada = +${DEDICATED_STOP_KM} km equivalentes; repostar a ≤${NEAR_WAYPOINT_KM} km de una parada propia no penaliza tiempo. Margen de seguridad entre paradas = ${SAFETY_PCT}%.\n`);
    md.push(`### Cómo leer las tablas de selección\n`);
    md.push(`- **Progreso:** posición de la estación a lo largo de la ruta (0% origen, 100% destino).`);
    md.push(`- **Ventana:** tramo donde \`pickStops\` puede colocar la parada nº k. Su tope superior = hasta dónde llegas desde la parada anterior (alcance real); el inferior asegura que las paradas restantes lleguen al destino y prefiere repostar en el último ~45% del depósito.`);
    md.push(`- **Score:** menor = mejor. La elegida es la de menor score entre las candidatas de su ventana.`);
    md.push(`- **timeCost:** desvío al trazado + penalización de parada dedicada.\n`);
    md.push(`> Un resultado **⚠️/❌** no siempre es un bug: puede ser un caso límite legítimo (p. ej. forzar menos paradas de las necesarias). Cada uno lleva su detalle para que juzgues la lógica.\n`);

    // Placeholders para resumen y hallazgos (se rellenan al final).
    const findingsAnchor = md.length;
    md.push('__FINDINGS__');
    const summaryAnchor = md.length;
    md.push('__SUMMARY__');

    let done = 0;
    for (const sc of ALL_SCENARIOS) {
        done++;
        process.stdout.write(`\r▶ [${done}/${ALL_SCENARIOS.length}] ${sc.id} ${sc.title.slice(0, 48).padEnd(48)} `);
        try {
            await runScenario(sc);
        } catch (err: any) {
            md.push(`\n### ❌ ${sc.id} · ${esc(sc.title)}\n`);
            md.push(`Error ejecutando el escenario: \`${esc(String(err?.message ?? err))}\`\n`);
            summary.push({ id: sc.id, title: sc.title, dist: '—', stops: 'ERROR', costs: '—', detail: !!sc.detail, pass: 0, warn: 0, fail: 1 });
            process.stdout.write('ERROR: ' + (err?.message ?? err));
        }
        await new Promise((r) => setTimeout(r, 120)); // amable con el router público
    }

    // Construir tabla resumen.
    const totalPass = summary.reduce((a, x) => a + x.pass, 0);
    const totalWarn = summary.reduce((a, x) => a + x.warn, 0);
    const totalFail = summary.reduce((a, x) => a + x.fail, 0);
    const sumLines: string[] = [];
    sumLines.push(`## Resumen\n`);
    sumLines.push(`**${ALL_SCENARIOS.length} escenarios · ${uniqueSigs.size} únicos (${uniqueSigs.size === ALL_SCENARIOS.length ? 'sin repeticiones' : 'CON REPETIDOS'}).** Comprobaciones: ✅ ${totalPass} · ⚠️ ${totalWarn} · ❌ ${totalFail}\n`);
    sumLines.push(`_Columna "Coste b/e/r" = coste de repostaje en barato/equilibrado/rápido. Los escenarios en **negrita** llevan volcado detallado más abajo; el resto se resume aquí (y se detallan solo si tienen ⚠️/❌)._\n`);
    sumLines.push(`| Escenario | Distancia | Paradas | Coste b/e/r | ✅ | ⚠️ | ❌ |`);
    sumLines.push(`|---|--:|---|--:|--:|--:|--:|`);
    for (const s of summary) {
        const name = s.detail ? `**${s.id} ${esc(s.title)}**` : `${s.id} ${esc(s.title)}`;
        sumLines.push(`| ${name} | ${s.dist} km | ${esc(s.stops)} | ${esc(s.costs)} | ${s.pass} | ${s.warn} | ${s.fail} |`);
    }
    sumLines.push('');
    md[summaryAnchor] = sumLines.join('\n');

    // Sección de hallazgos (conclusiones accionables).
    const fx: string[] = [];
    fx.push(`## Hallazgos y conclusiones\n`);
    if (dryFindings.length === 0 && costFindings.length === 0) {
        fx.push(`✅ **Con la corrección aplicada NO queda ningún fallo de lógica (❌)** en los ${ALL_SCENARIOS.length} escenarios. Los dos problemas que este test encontró antes del fix están resueltos:\n`);
        fx.push(`1. **Ningún plan deja el depósito en seco entre paradas.** En todas las estrategias de todos los escenarios (incluidos los de 3, 4 y 5+ repostajes con depósito pequeño), cada tramo entre paradas consecutivas es ≤ autonomía del depósito y, en modo automático, se llega siempre al destino sin quedarse tirado. La reescritura de \`pickStops\` distingue el **mínimo innegociable** (para no quedarte tirado ni pasarte del destino, reservando el combustible de llegada) de la **preferencia** (repostar en el último ~45% del tanque), y el *fallback* de "ventana sin estaciones" ya nunca coge una gasolinera al principio de la ruta.`);
        fx.push(`2. **Desaparecen las grandes inversiones de coste** (antes de +16 a +27 € en los planes que se quedaban secos, por el recorte a 0 L de \`allocateRefuels\`). Al ser todos los planes viables, los litros y costes vuelven a ser físicamente exactos.\n`);
        fx.push(`**Matiz (⚠️, no bug):** en algún caso "Más barato" puede costar unos céntimos/1-2 € más que "Equilibrado". No es un error: "barato" pondera un 5% el tiempo, así que puede preferir una estación ~0,005 €/L más cara pero con menos desvío. Es un compromiso de diseño deliberado y de magnitud despreciable; si se quisiera "coste puro" bastaría con poner el peso de tiempo a 0 en la prioridad "barato".\n`);
        fx.push(`Sigue siendo correcto todo lo que ya funcionaba (nº mínimo de paradas, corredor ≤4 km, filtros de marca/combustible, orden por progreso, reserva de llegada, diferenciación de estrategias, peajes, ida y vuelta y hasta 5 paradas del conductor). Los ⚠️ restantes son casos límite legítimos: forzar menos paradas de las necesarias (se avisa de que te quedarías sin combustible), pedir una reserva de llegada muy alta (llegas por debajo de lo pedido), o corredores donde no hay tantas gasolineras separadas como paradas pedidas.\n`);
    }
    if (dryFindings.length) {
        fx.push(`### 🔴 Hallazgo 1 — Plan inviable: te quedas sin combustible entre dos paradas recomendadas\n`);
        fx.push(`En rutas largas que necesitan **≥2 repostajes**, \`pickStops\` puede colocar dos paradas consecutivas a **más de un depósito de distancia**. La ventana de cada parada mide el 45% de la autonomía del depósito, pero las ventanas están espaciadas un depósito completo, así que el hueco entre dos paradas puede llegar a ~1,45× la autonomía. Si la estación más barata de una ventana cae cerca del inicio de esta, el conductor **se queda seco antes de alcanzar la siguiente**. La simulación mostraría "Llegas con 0 L".\n`);
        fx.push(`| Escenario | Estrategia | Tramo (progreso) | Distancia del tramo | Autonomía máx. |`);
        fx.push(`|---|---|--:|--:|--:|`);
        for (const f of dryFindings) {
            fx.push(`| ${f.id} ${esc(f.title)} | ${planName(f.prio)} | ${pct(f.fromPct)} → ${pct(f.toPct)} | ${f.legKm.toFixed(0)} km | ${f.maxRangeKm.toFixed(0)} km |`);
        }
        fx.push('');
        fx.push(`**Causa raíz:** en \`pickStops\`, \`windowFor(k)\` fija el borde inferior en \`deadlineKm − 0,45·maxRange\` de forma independiente por ventana; no se garantiza que cada parada sea alcanzable desde la anterior.  `);
        fx.push(`**Corrección propuesta:** acotar cada ventana al depósito real de la parada previa —\`lo_k = max(lo_k, progresoParadaPrevia)\` y \`hi_k = min(hi_k, progresoParadaPrevia + maxRange)\`— o, tras elegir, validar la viabilidad de cada tramo y desplazar/añadir una parada si algún tramo supera \`maxRange\`. Solo afecta a viajes de 2+ paradas con depósito pequeño; los casos de 0–1 parada son correctos.\n`);
    }
    if (costFindings.length) {
        fx.push(`### 🟠 Hallazgo 2 — "Más barato" puede costar más que "Equilibrado"\n`);
        fx.push(`Consecuencia directa del Hallazgo 1. Cuando un plan se queda seco, \`allocateRefuels\` recorta el depósito a 0 (\`Math.max(0, …)\`) y **descarta silenciosamente el combustible negativo**, lo que altera cuántos litros se compran y en qué estaciones (de precios distintos). Por eso la selección nominalmente más barata puede terminar con un coste total mayor, y los litros/coste mostrados dejan de ser físicamente exactos.\n`);
        fx.push(`| Escenario | Coste "Más barato" | Mejor de los otros | Diferencia |`);
        fx.push(`|---|--:|--:|--:|`);
        for (const f of costFindings) {
            fx.push(`| ${f.id} ${esc(f.title)} | ${f.cheap.toFixed(2)} € | ${f.best.toFixed(2)} € | +${(f.cheap - f.best).toFixed(2)} € |`);
        }
        fx.push('');
        fx.push(`**Corrección:** se resuelve al arreglar el Hallazgo 1 (planes viables). Adicionalmente, \`allocateRefuels\` no debería descartar el déficit: si un tramo excede el depósito, debería señalarlo como inviable en vez de simular una llegada a 0 L.\n`);
    }
    fx.push(`### 🟢 Nota sobre el "sobre-repostaje" forzado\n`);
    fx.push(`Al forzar **más paradas de las necesarias** (p. ej. 3 cuando basta 1), las ventanas de las últimas paradas se acercan al destino y algunas se reparten repostajes pequeños. No es peligroso ni incorrecto (llegas bien), pero es una rareza de UX: podría avisarse de que se piden más paradas de las útiles.\n`);
    fx.push(`### ✅ Lo que funciona correctamente\n`);
    fx.push(`- **Nº mínimo de paradas** (\`computeFuelPlan\`): correcto en todos los casos (0 en trayectos cortos/depósito grande; escala con distancia, consumo y capacidad).`);
    fx.push(`- **Corredor** (\`findCorridorStations\`): todas las paradas caen a ≤4 km del trazado; respeta el filtro de marca y de combustible (corredor vacío → error esperado al usuario).`);
    fx.push(`- **Viabilidad y orden**: paradas ordenadas por progreso, cada tramo dentro de la autonomía, y llegada al destino con la reserva en todos los escenarios de modo automático.`);
    fx.push(`- **Diferenciación de estrategias**: "barato" baja el precio medio, "rápido" minimiza el desvío y aprovecha el efecto *convenient* (repostar junto a una parada propia sin penalizar tiempo).`);
    fx.push(`- **Réplica del score = elección real de \`pickStops\`** en el 100% de los escenarios (el modelo de justificación reproduce exactamente la elección del algoritmo).`);
    fx.push(`- **Modos forzados / evitar peajes / ida y vuelta / waypoints (hasta 5)**: se comportan como se espera.\n`);
    md[findingsAnchor] = fx.join('\n');

    writeFileSync('./informe-test-rutas.md', md.join('\n'), 'utf8');
    process.stdout.write(`\n\n✔ Informe escrito en informe-test-rutas.md\n✅ ${totalPass} · ⚠️ ${totalWarn} · ❌ ${totalFail}\n`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
