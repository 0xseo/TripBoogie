import { createPlaceDetailsHandler } from "../../../server/place-details";
import { resolveRequestUser } from "../../../server/auth-provider";
import { TripRepository } from "../../../server/repository";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=30;
export const POST=createPlaceDetailsHandler({key:process.env.GEOAPIFY_API_KEY??"",resolveUser:resolveRequestUser,budget:(r)=>new TripRepository({url:process.env.SUPABASE_URL??"",publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY??"",authorization:r.headers.get("authorization")??""}).mapBudget()});
