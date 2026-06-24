import type { FuelType } from '../types/gasolinera';

/** Etiqueta corta legible para cada combustible. */
export const FUEL_LABELS: Record<FuelType, string> = {
    sp95: 'SP95',
    sp95Premium: 'SP95 Pro',
    sp98: 'SP98',
    diesel: 'Diésel',
    dieselPremium: 'Diésel Pro',
    dieselB: 'Gasóleo B',
    glp: 'GLP',
    gnc: 'GNC',
    gnl: 'GNL',
    hydrogen: 'H₂',
};

/** Combustibles de acceso rápido en el selector principal. */
export const MAIN_FUELS: FuelType[] = ['sp95', 'sp98', 'diesel'];

/** Resto de combustibles (selector "otros"). */
export const OTHER_FUELS: FuelType[] = [
    'sp95Premium',
    'dieselPremium',
    'glp',
    'gnc',
    'gnl',
    'dieselB',
    'hydrogen',
];

/** Orden de presentación en la tarjeta de estación. */
export const FUEL_ORDER: FuelType[] = [...MAIN_FUELS, ...OTHER_FUELS];
