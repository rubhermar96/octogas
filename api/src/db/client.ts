import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL (copia api/.env.example a api/.env).");
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
