import { slugify } from "./lib/slug";
import { fuelEnum, type FuelKey } from "./db/schema";

/** Combustibles para los que calculamos medias agregadas: todos (sin favoritos). */
export const ROLLUP_FUELS: FuelKey[] = [...fuelEnum.enumValues];

export type ScopeType = "national" | "province" | "municipio";

export interface ScopeAvg {
    scopeType: ScopeType;
    scopeId: string;
    fuel: FuelKey;
    avgPrice: number;
    n: number;
}

interface RawLike {
    province: string;
    city: string;
    prices: Record<string, number | null>;
}

/** scopeId de un municipio: 'provinciaSlug|municipioSlug' (igual que la web). */
export function municipioScopeId(province: string, city: string): string {
    return `${slugify(province)}|${slugify(city)}`;
}

/**
 * Media de precio de cada combustible por ámbito nacional, provincia y
 * municipio a partir de los precios actuales de las gasolineras.
 */
export function computeScopeAverages(raw: RawLike[]): ScopeAvg[] {
    const acc = new Map<string, { sum: number; n: number; scopeType: ScopeType; scopeId: string; fuel: FuelKey }>();
    const add = (scopeType: ScopeType, scopeId: string, fuel: FuelKey, price: number) => {
        const k = `${scopeType}${scopeId}${fuel}`;
        let a = acc.get(k);
        if (!a) {
            a = { sum: 0, n: 0, scopeType, scopeId, fuel };
            acc.set(k, a);
        }
        a.sum += price;
        a.n++;
    };

    for (const s of raw) {
        for (const fuel of ROLLUP_FUELS) {
            const price = s.prices?.[fuel];
            if (price == null) continue;
            add("national", "", fuel, price);
            if (s.province) add("province", slugify(s.province), fuel, price);
            if (s.province && s.city) add("municipio", municipioScopeId(s.province, s.city), fuel, price);
        }
    }

    return [...acc.values()].map((a) => ({
        scopeType: a.scopeType,
        scopeId: a.scopeId,
        fuel: a.fuel,
        avgPrice: Math.round((a.sum / a.n) * 1000) / 1000,
        n: a.n,
    }));
}
