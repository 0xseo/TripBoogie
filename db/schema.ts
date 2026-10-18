import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull(),
});

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  destination: text("destination").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  currency: text("currency").notNull(),
  timezone: text("timezone").notNull(),
  version: integer("version").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tripMembers = sqliteTable(
  "trip_members",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.userId] }),
    index("members_by_user").on(table.userId),
  ],
);

export const tripRecords = sqliteTable(
  "trip_records",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["plan", "place", "expense", "checklist"] }).notNull(),
    dataJson: text("data_json").notNull(),
    version: integer("version").notNull().default(1),
    deleted: integer("deleted").notNull().default(0),
    mutationId: text("mutation_id").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [index("records_by_trip").on(table.tripId, table.deleted)],
);

export const tripInvites = sqliteTable(
  "trip_invites",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [index("invites_by_trip").on(table.tripId)],
);
