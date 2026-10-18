export type ItemKind = "plan" | "place" | "expense" | "checklist";
export type Role = "owner" | "editor" | "viewer";
export interface Trip {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  currency: string;
  timezone: string;
  version: number;
  revision: number;
  role: Role;
  memberCount: number;
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
}
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Workspace {
  trip: Trip;
  records: ItemRecord[];
  members: Member[];
  revision: number;
}
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}
export interface MeResponse {
  user: CurrentUser | null;
  signInUrl: string;
  signOutUrl: string;
}
export interface TripAppProps {
  initialUser?: CurrentUser | null;
}
export interface Invite {
  id: string;
  role: "editor" | "viewer";
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}
