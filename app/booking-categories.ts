import type { TripSettings, BookingCategory } from "./types";
export const defaultBookingCategories:BookingCategory[]=[{id:"hotel",label:"숙소",kind:"hotel"},{id:"flight",label:"항공",kind:"flight"},{id:"tour",label:"투어·티켓",kind:"tour"},{id:"other",label:"기타",kind:"other"}];
export const fixedBookingCategory=(id:string)=>["hotel","flight","tour"].includes(id);
export function bookingCategories(settings:TripSettings){const saved=settings.bookingCategories||defaultBookingCategories;return [...saved,...defaultBookingCategories.filter(c=>fixedBookingCategory(c.id)&&!saved.some(row=>row.id===c.id))];}
