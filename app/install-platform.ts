export type InstallPlatform="android"|"ios"|"desktop";
export function installPlatform(userAgent:string,platform:string,maxTouchPoints:number):InstallPlatform {
  if(/iPad|iPhone|iPod/.test(userAgent)||(platform==="MacIntel"&&maxTouchPoints>1))return "ios";
  return /Android/i.test(userAgent)?"android":"desktop";
}
