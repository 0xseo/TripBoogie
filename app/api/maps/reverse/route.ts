import {createMapHandler} from "../../../server/maps";
import {resolveRequestUser} from "../../../server/auth-provider";
import {TripRepository} from "../../../server/repository";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=30;
export async function POST(request:Request){
 return createMapHandler({key:process.env.GEOAPIFY_API_KEY??"",resolveUser:resolveRequestUser,
 budget:current=>new TripRepository({url:process.env.SUPABASE_URL??"",publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY??"",authorization:current.headers.get("authorization")??""}).mapBudget()
 })(request,"reverse");
}
