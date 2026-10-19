import type { ItemRecord } from "./types";
import { comparePlans, placePoint } from "./planning";
export type Point = {
  id: string;
  planId: string;
  name: string;
  lat: number;
  lng: number;
  number: number;
};
export type Leg = { from: Point; to: Point; meters: number; plan: ItemRecord };
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const r = Math.PI / 180,
    h =
      Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
      Math.cos(a.lat * r) *
        Math.cos(b.lat * r) *
        Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export type Connection={from:ItemRecord;to:ItemRecord;leg?:Leg};
export function dayGraph(plans: ItemRecord[], places: ItemRecord[]) {
  const lookup = new Map(places.map((p) => [p.id, p]));
  const points: Point[] = [],
    legs: Leg[] = [], connections:Connection[]=[];
  let previousPlan:ItemRecord|null=null;
  let previous: Point | null = null;
  let number = 0;
  for (const plan of [...plans].sort(comparePlans)) {
    if (plan.data.entryType === "memo") continue;
    number++;
    const connection:Connection|undefined=previousPlan?{from:previousPlan,to:plan}:undefined;
    if(connection)connections.push(connection);
    previousPlan=plan;
    const place = lookup.get(String(plan.data.placeId)),
      p = placePoint(place);
    if (!place || !p) {
      previous = null;
      continue;
    }
    const point = {
      ...p,
      id: place.id,
      planId: plan.id,
      name: String(plan.data.title || place.data.name),
      number,
    };
    points.push(point);
    if (previous) {
      const leg={from:previous,to:point,meters:distanceMeters(previous,point),plan};
      legs.push(leg);
      if(connection)connection.leg=leg;
    }
    previous = point;
  }
  return { points, legs, connections };
}
export const modes = [
  { id: "walk", name: "도보" },
  { id: "drive", name: "자동차" },
  { id: "train", name: "기차" },
  { id: "flight", name: "비행기" },
  { id: "ferry", name: "배" },
  { id: "bus", name: "버스" },
  { id: "bicycle", name: "자전거" },
  { id: "other", name: "기타" },
];
export const distanceLabel = (meters: number) =>
  meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
