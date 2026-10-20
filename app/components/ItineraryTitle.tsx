import type {ItemRecord} from "../types";
import {flightEventTitle} from "../booking-display";
export default function ItineraryTitle({plan, booking}: {plan: ItemRecord; booking?: ItemRecord}) {
  const flight = flightEventTitle(plan, booking);
  return flight ? <><span className="flight-plan-route">{flight.route}</span><span className="flight-plan-detail">{flight.detail}</span></> : <>{String(plan.data.title || "")}</>;
}
