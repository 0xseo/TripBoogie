import type { Profile } from "./types";
const editable=["name","baseCurrency","holidayCountry","searchLanguage","theme","mapHeightScale"] as const;
/** Read DTOs contain derived social photos. Only explicit editable fields belong in an account write. */
export function profileUpdate(profile:Pick<Profile,"version">,changes:Record<string,unknown>) {
 const payload:Record<string,unknown>={version:profile.version};
 for(const key of editable)if(Object.hasOwn(changes,key))payload[key]=changes[key];
 return payload;
}
