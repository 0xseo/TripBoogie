"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ChevronRight,Download,Globe,Share,PlusSquare,Smartphone} from "lucide-react";
import Image from "next/image";
import {isNativeApp} from "../runtime";
import {appInfo} from "../app-info";
import {installPlatform,type InstallPlatform} from "../install-platform";
import {Dialog} from "./ui";
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:"accepted"|"dismissed"}>};
export function InstallOptions({platform,onWebInstall}:{platform:InstallPlatform;onWebInstall:()=>Promise<boolean>}) {
  const [choice,setChoice]=useState<"choose"|"apk"|"web">("choose"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function web(){setBusy(true);setError("");try{if(!await onWebInstall())setChoice("web");}catch{setChoice("web");setError("브라우저 메뉴에서 설치해북.");}finally{setBusy(false);}}
  if(platform==="ios")return <ol className="install-steps"><li><Share size={18}/><span>Safari에서 <strong>공유</strong>를 눌러북</span></li><li><PlusSquare size={18}/><span><strong>홈 화면에 추가</strong>를 선택해북</span></li><li><span><strong>웹 앱으로 열기</strong>를 켜고 추가해북</span></li></ol>;
  if(platform==="desktop"||choice==="apk")return <div className="install-apk">{platform==="android"&&<button type="button" className="install-back" aria-label="설치 방법 다시 선택" onClick={()=>setChoice("choose")}><ArrowLeft size={17}/></button>}<p>{platform==="desktop"?"Android 휴대폰 전용 앱이에요.":"다운로드한 APK를 열어 설치해북."}</p>{platform==="desktop"?<small>PC에 받은 파일은 Android 휴대폰으로 옮겨서 열어북.</small>:<small>설치 경고가 나오면 트립부기 파일인지 확인하고 <strong>‘무시하고 설치’</strong>를 선택해북.<br/>필요하면 이 브라우저의 ‘출처를 알 수 없는 앱 설치’를 허용해북.</small>}<a className="primary apk-download" href={`/downloads/TripBoogie_${appInfo.version}.apk`} download={`TripBoogie_${appInfo.version}.apk`}><Download size={18}/>Android APK 다운로드</a></div>;
  if(choice==="web")return <div className="install-web-help"><button type="button" className="install-back" aria-label="설치 방법 다시 선택" onClick={()=>setChoice("choose")}><ArrowLeft size={17}/></button><p>브라우저 메뉴에서 <strong>앱 설치</strong> 또는 <strong>현재 페이지 추가 → 웹앱으로 설치</strong>를 선택해북.</p>{error&&<p className="error" role="alert">{error}</p>}</div>;
  return <div className="install-options"><button type="button" className="install-option" disabled={busy} onClick={()=>setChoice("apk")}><Smartphone size={23}/><span><strong>APK 앱</strong><small>빠르게 실행하고, 업데이트는 직접 설치해북</small></span><ChevronRight size={17}/></button><button type="button" className="install-option" disabled={busy} onClick={()=>void web()}><Globe size={23}/><span><strong>웹앱</strong><small>가볍게 설치하고, 업데이트는 자동으로 해북</small></span><ChevronRight size={17}/></button></div>;
}
export default function InstallPrompt(){
 const [installed,setInstalled]=useState(false),[open,setOpen]=useState(false),[platform,setPlatform]=useState<InstallPlatform>("desktop");
 const eventRef=useRef<InstallEvent|null>(null);
 useEffect(()=>{
  if(isNativeApp())return;
  const standalone=()=>window.matchMedia("(display-mode: standalone)").matches||("standalone" in navigator&&navigator.standalone===true);
  let dismissed=false;try{dismissed=Number(localStorage.getItem("tripboogie-install-dismiss-until"))>Date.now();}catch{}
  const environmentTimer=setTimeout(()=>{setInstalled(standalone());setPlatform(installPlatform(navigator.userAgent,navigator.platform,navigator.maxTouchPoints));},0);
  const timer=setTimeout(()=>{if(!standalone()&&!dismissed&&window.matchMedia("(max-width: 700px)").matches&&!document.querySelector("dialog[open]")&&!location.pathname.startsWith("/auth/"))setOpen(true);},1800);
  const before=(event:Event)=>{event.preventDefault();eventRef.current=event as InstallEvent;};
  const done=()=>{setInstalled(true);setOpen(false);eventRef.current=null;};
  window.addEventListener("beforeinstallprompt",before);window.addEventListener("appinstalled",done);
  if("serviceWorker" in navigator)void navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).catch(()=>{});
  return()=>{clearTimeout(timer);clearTimeout(environmentTimer);window.removeEventListener("beforeinstallprompt",before);window.removeEventListener("appinstalled",done);};
 },[]);
 function close(){setOpen(false);try{localStorage.setItem("tripboogie-install-dismiss-until",String(Date.now()+7*86400000));}catch{}}
 async function installWeb(){const event=eventRef.current;if(!event)return false;eventRef.current=null;await event.prompt();const result=await event.userChoice;if(result.outcome==="accepted"){setInstalled(true);setOpen(false);}return true;}
 if(installed||isNativeApp())return null;
 return <><button type="button" className="install-trigger" onClick={()=>setOpen(true)}><Download size={17}/><span>앱 설치</span></button>{open&&<Dialog title="앱 설치" onClose={close}><div className="stack install-content"><Image unoptimized src="/icon-192.png" width={64} height={64} alt="거북이 부기"/><InstallOptions platform={platform} onWebInstall={installWeb}/></div></Dialog>}</>;
}
