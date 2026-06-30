import {
    pgTable,
    pgEnum,
    text,
    doublePrecision,
    real,
    timestamp,
    bigserial,
    primaryKey,
    index,
} from "drizzle-orm/pg-core";

/** Combustibles (mismas claves que el JSON de la web / MITECO). */
export const fuelEnum = pgEnum("fuel", [
    "sp95",
    "sp95Premium",
    "sp98",
    "diesel",
    "dieselPremium",
    "dieselB",
    "glp",
    "gnc",
    "gnl",
    "hydrogen",
]);

/** Espejo de las gasolineras (datos descriptivos, se upsertan en cada ingesta). */
export const stations = pgTable("stations", {
    id: text("id").primaryKey(),
    name: text("name").notNull().default(""),
    brand: text("brand").notNull().default(""),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    province: text("province").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    idMunicipio: text("id_municipio").notNull().default(""),
    idProvincia: text("id_provincia").notNull().default(""),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    saleType: text("sale_type").notNull().default(""),
    schedule: text("schedule").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Último precio conocido por estación y combustible (para detectar cambios rápido). */
export const currentPrices = pgTable(
    "current_prices",
    {
        stationId: text("station_id")
            .notNull()
            .references(() => stations.id, { onDelete: "cascade" }),
        fuel: fuelEnum("fuel").notNull(),
        price: real("price").notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.stationId, t.fuel] })]
);

/** Histórico: se inserta SOLO cuando el precio cambia respecto al último conocido. */
export const priceObservations = pgTable(
    "price_observations",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        stationId: text("station_id")
            .notNull()
            .references(() => stations.id, { onDelete: "cascade" }),
        fuel: fuelEnum("fuel").notNull(),
        price: real("price").notNull(),
        observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("obs_station_fuel_time").on(t.stationId, t.fuel, t.observedAt)]
);

export type FuelKey = (typeof fuelEnum.enumValues)[number];
