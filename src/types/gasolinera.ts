export interface GasStation {
    id: string;
    name: string;
    address: string;
    city: string;
    province: string;
    lat: number;
    lng: number;
    prices: {
        sp95: number | null;
        sp98: number | null;
        diesel: number | null;
    };
    brand: string;
    schedule: string;
}