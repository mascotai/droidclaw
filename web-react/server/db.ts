import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(process.env.DATABASE_URL, {
	idle_timeout: 20,
	max_lifetime: 60 * 5,
	connect_timeout: 10
});

export const db = drizzle(client, { schema });
