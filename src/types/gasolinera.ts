export interface FuelPrices {
    sp95: number | null;          // Gasolina 95 E5
    sp95Premium: number | null;   // Gasolina 95 E5 Premium
    sp98: number | null;          // Gasolina 98 E5
    diesel: number | null;        // Gasóleo A
    dieselPremium: number | null; // Gasóleo Premium
    dieselB: number | null;       // Gasóleo B (agrícola)
    glp: number | null;           // Gases licuados del petróleo (autogas)
    gnc: number | null;           // Gas Natural Comprimido
    gnl: number | null;           // Gas Natural Licuado
    hydrogen: number | null;      // Hidrógeno
}

export type FuelType = keyof FuelPrices;

export interface GasStation {
    id: string;
    name: string;
    brand: string;
    address: string;
    city: string;
    province: string;
    postalCode: string;
    idMunicipio: string;
    idProvincia: string;
    lat: number;
    lng: number;
    saleType: string; // "P" público / "R" restringido (cooperativas, flotas)
    schedule: string;
    prices: FuelPrices;
}
