export type ItemKind = "plan" | "place" | "expense" | "checklist" | "booking";
export type Role = "owner" | "editor" | "viewer";
export interface Trip {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  currency: string;
  timezone: string;
  settings: TripSettings;
  version: number;
  revision: number;
  role: Role;
  memberCount: number;
  flightNights?: number;
  memberPreview?: { id: string; name: string; avatar?: string }[];
  updatedAt: string;
  createdAt: string;
}
export interface ItemRecord {
  id: string;
  kind: ItemKind;
  data: Record<string, unknown>;
  version: number;
  updatedAt: string;
  updatedBy: string;
  createdBy?: string;
  createdName?: string;
}
export interface Member {
  avatar?: string;
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Workspace {
  brainstorm?: import("./brainstorm").BrainDocument[];
  trip: Trip;
  records: ItemRecord[];
  members: Member[];
  files: TripFile[];
  revision: number;
  overview?: OverviewRow[];
}
export interface OverviewRow {
  date: string;
  text: string;
  sourceIds: string[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}
export type OverviewChange = Pick<OverviewRow, "date" | "text" | "sourceIds" | "version">;
export interface CurrentUser {
  provider?: "google" | "kakao" | "email";
  id: string;
  name: string;
  email: string;
}
export interface Invite {
  id: string;
  role: "editor" | "viewer";
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface Profile extends CurrentUser {
  withdrawnAt?:string|null;
  avatar?: string;
  theme?: "system" | "light" | "dark";
  mapHeightScale?: number;
  baseCurrency: string;
  holidayCountry?: string;
  searchLanguage?: string;
  version: number;
}
export interface Category {
  id: string;
  label: string;
}
export interface TravelCity {
  transit?: boolean;
  providerId?: string;
  id: string;
  name: string;
  address: string;
  countryCode: string;
  timezone: string;
  lat: number;
  lng: number;
  currency: string;
  startDate: string;
  endDate: string;
}
export interface BookingCategory extends Category { kind: "hotel" | "flight" | "tour" | "other"; }
export interface TripSettings {
  countries?: string[];
  currencies?: string[];
  fileTags?: Category[];
  bookingCategories?: BookingCategory[];
  cities?: TravelCity[];
  expenseCategories: Category[];
  checklistCategories: Category[];
  location?: { name: string; address: string; lat: number; lng: number };
}
export interface TripFile {
  tags?: string[];
  version?: number;
  id: string;
  trip_id: string;
  booking_id: string | null;
  path: string;
  name: string;
  mime: string;
  size: number;
  status: "pending" | "ready" | "deleting";
  uploaded_by: string | null;
  created_at: string;
}

export interface Bootstrap { user: CurrentUser | null; profile: Profile | null; trips: Trip[]; }
