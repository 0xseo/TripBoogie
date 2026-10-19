"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { bindPullRefresh, pullRefreshThreshold } from "../pull-to-refresh";
export default function PullToRefresh({children,enabled,onRefresh}:{children:ReactNode;enabled:boolean;onRefresh:()=>Promise<unknown>}) {
  const ref=useRef<HTMLDivElement>(null), [distance,setDistance]=useState(0), [refreshing,setRefreshing]=useState(false);
  const running=useRef(false), alive=useRef(true), latest=useRef({enabled,onRefresh});
  useEffect(()=>{latest.current={enabled,onRefresh};},[enabled,onRefresh]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const performRefresh=useCallback(async()=>{
    if(running.current||!latest.current.enabled)return;
    running.current=true;setRefreshing(true);setDistance(0);
    try { await latest.current.onRefresh(); } catch { /* The screen owns its API error message. */ }
    finally { running.current=false;if(alive.current){setRefreshing(false);setDistance(0);} }
  },[]);
  useEffect(()=>{
    const root=ref.current;if(!root)return;
    const surface=root.closest("main")||root;
    return bindPullRefresh(surface,{
      isAtTop:()=>window.scrollY<=1&&(document.scrollingElement?.scrollTop??0)<=1,
      canStart:(eventTarget)=>{
        if(!latest.current.enabled||running.current||document.querySelector('dialog[open]'))return false;
        const target=eventTarget instanceof Element?eventTarget:null;
        if(target?.closest('input,textarea,select,.maplibregl-map,[draggable="true"],[data-no-pull-refresh]'))return false;
        for(let el=target;el&&el!==surface;el=el.parentElement)if(el.scrollTop>1&&el.scrollHeight>el.clientHeight+2&&/(auto|scroll)/.test(getComputedStyle(el).overflowY))return false;
        return true;
      },
      onPull:setDistance,
      onRefresh:()=>void performRefresh(),
    });
  },[performRefresh]);
  const shown=enabled&&!refreshing?distance:0;
  return <div ref={ref} className="pull-refresh-root"><button type="button" className="refresh-accessible" disabled={!enabled||refreshing} onClick={()=>void performRefresh()}>현재 화면 새로고침</button><div className="pull-indicator" style={{height:shown}} aria-hidden={!shown}><span><ArrowDown size={19}/><span>{distance>=pullRefreshThreshold?"놓으면 새로고침":"당겨서 새로고침"}</span></span></div>{children}</div>;
}
