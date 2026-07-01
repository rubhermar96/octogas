import "dotenv/config";
import { resolve } from "node:path";
import { pool } from "../db/client";
import { runIngest } from "./core";

const STATIONS_PATH =
    process.env.STATIONS_JSON ?? resolve(process.cwd(), "../public/data/stations.json");

async function main() {
    console.log("Ingesta (snapshot actual):");
    const res = await runIngest(STATIONS_PATH, new Date());
    console.log(`Ingesta completada: ${res.stationCount} estaciones, ${res.changedCount} cambios de precio.`);
    await pool.end();
}

main().catch((err) => {
    console.error("Error en la ingesta:", err);
    process.exit(1);
});
