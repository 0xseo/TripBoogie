import type { ItemRecord, Workspace } from "../../types";
import { emptyOverview, importOverview, overviewCandidates } from "../../itinerary-overview";
import { itineraryDays } from "../../planning";

// Self-contained demonstration data from the planning example. No live account/DB.
const records: ItemRecord[] = [];
function record(kind: ItemRecord["kind"], id: string, data: ItemRecord["data"]) {
  records.push({ kind, id, data, version: 1, updatedAt: "2026-10-21T00:00:00Z", updatedBy: "overview-preview" });
  return id;
}
const cities = {
  auckland: { name: "오클랜드", lat: -36.85, lng: 174.76 },
  rotorua: { name: "로토루아", lat: -38.13, lng: 176.25 },
  wellington: { name: "웰링턴", lat: -41.28, lng: 174.77 },
  queenstown: { name: "퀸스타운", lat: -45.03, lng: 168.66 },
  christchurch: { name: "크라이스트처치", lat: -43.53, lng: 172.63 },
  sydney: { name: "시드니", lat: -33.86, lng: 151.2 },
  seoul: { name: "인천", lat: 37.46, lng: 126.45 },
};
for (const [id, city] of Object.entries(cities)) record("place", id, city);
function plan(date: string, title: string, time = "", placeId = "rotorua", extra: Record<string, unknown> = {}) {
  const position = records.filter(item => item.kind === "plan" && item.data.date === date).length + 1;
  return record("plan", `preview-${date}-${position}`, { date, title, time, position, placeId, entryType: "plan", duration: 0, transportMode: "other", ...extra });
}
function flight(id: string, date: string, from: keyof typeof cities, to: keyof typeof cities, start: string, end: string, arrivalDate = date) {
  const airport = (key: keyof typeof cities) => ({ name: `${cities[key].name} 공항`, iata: ({ auckland: "AKL", rotorua: "ROT", wellington: "WLG", queenstown: "ZQN", christchurch: "CHC", sydney: "SYD", seoul: "ICN" })[key] });
  record("booking", id, { type: "flight", title: `${cities[from].name} → ${cities[to].name}`, startDate: date, endDate: arrivalDate, startTime: start, endTime: end, departureAirport: airport(from), arrivalAirport: airport(to) });
  plan(date, `${cities[from].name} 출발`, start, from, { bookingId: id, bookingEvent: "departure" });
  plan(arrivalDate, `${cities[to].name} 도착`, end, to, { bookingId: id, bookingEvent: "arrival" });
}
flight("flight-1", "2026-11-24", "seoul", "auckland", "18:25", "09:55", "2026-11-25");
flight("flight-2", "2026-11-26", "auckland", "rotorua", "18:20", "19:05");
record("booking", "hotel-1", { type: "hotel", title: "로토루아 숙소", startDate: "2026-11-26", endDate: "2026-11-28" });
plan("2026-11-26", "로토루아 숙소 · 체크인", "", "rotorua", { bookingId: "hotel-1", bookingEvent: "checkin" });
plan("2026-11-27", "캐노피 투어", "08:30", "rotorua", { duration: 180 });
plan("2026-11-27", "루지 탑승", "12:00");
plan("2026-11-27", "점심 + 숙소에서 정비");
plan("2026-11-27", "블루스프링", "15:30");
plan("2026-11-27", "호비튼 마을", "17:00");
plan("2026-11-27", "저녁 + 폴리네시안 스파");
plan("2026-11-27", "로토루아 숙소", "", "rotorua", { bookingId: "hotel-1", bookingEvent: "stay" });
plan("2026-11-28", "로토루아 사진명소 · 테푸이아 + 레드우즈");
flight("flight-3", "2026-11-28", "rotorua", "wellington", "11:55", "13:10");
flight("flight-4", "2026-11-28", "wellington", "queenstown", "13:55", "15:20");
plan("2026-11-28", "렌터카로 와나카 → 페얼리", "", "queenstown");
plan("2026-11-29", "테카포 → 퀸스타운 · 관광/쇼핑", "", "queenstown");
plan("2026-11-29", "온센 핫풀", "20:00", "queenstown", { duration: 105 });
plan("2026-11-30", "퀸스타운 투어 · 밀포드 사운드", "", "queenstown");
plan("2026-12-01", "마운트쿡 투어", "06:30", "queenstown");
flight("flight-5", "2026-12-02", "queenstown", "christchurch", "10:25", "11:20");
plan("2026-12-02", "윌로우뱅크 → 카이코우라 (렌터카)", "", "christchurch");
plan("2026-12-03", "카이코우라 돌핀 스윔", "05:30", "christchurch");
plan("2026-12-03", "카이코우라 → 크라이스트처치 (렌터카)", "", "christchurch");
flight("flight-6", "2026-12-03", "christchurch", "sydney", "18:10", "19:40");
plan("2026-12-05", "불꽃놀이", "21:00", "sydney");
flight("flight-7", "2026-12-07", "sydney", "seoul", "11:40", "20:15");

export const overviewPreviewWorkspace: Workspace = {
  trip: { id: "overview-preview-nz-sydney", title: "뉴질랜드 & 시드니 · 예시 여행", destination: "뉴질랜드 · 호주", startDate: "2026-11-24", endDate: "2026-12-07", currency: "NZD", timezone: "Pacific/Auckland", settings: { expenseCategories: [], checklistCategories: [] }, version: 1, revision: 1, role: "owner", memberCount: 1, updatedAt: "2026-10-21T00:00:00Z", createdAt: "2026-10-21T00:00:00Z" },
  records, members: [], files: [], revision: 1,
};
export const overviewPreviewDays = itineraryDays(overviewPreviewWorkspace.trip, records);
export const overviewPreviewDraft = importOverview(emptyOverview(), overviewPreviewDays.flatMap(date => overviewCandidates(overviewPreviewWorkspace, date).filter(item => !item.hotel)), "replace");
