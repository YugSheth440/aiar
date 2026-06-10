import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const hazardTaxonomy = sqliteTable('hazard_taxonomy', {
  id: integer('id').primaryKey(),
  label: text('label').notNull().unique(),
  category: text('category'),
  description: text('description'),
  icon: text('icon'),
  default_guidance: text('default_guidance'), // Stored as JSON string
});
