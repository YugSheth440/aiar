import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

export const sqliteDb = openDatabaseSync('fixsight_offline.db');
export const db = drizzle(sqliteDb, { schema });
