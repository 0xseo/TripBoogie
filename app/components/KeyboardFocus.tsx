"use client";
import {useEffect} from "react";
export function revealFocusedInput(container?:HTMLElement){
 const input=document.activeElement;
 if(!(input instanceof HTMLElement)||!input.matches('input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]'))return;
 const dialog=input.closest('dialog');if(container?dialog!==container:!!dialog)return;
 const viewport=window.visualViewport,top=(viewport?.offsetTop||0)+(container?Math.max(12,container.querySelector('header')?.getBoundingClientRect().height||0):12),bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-(container?72:96),rect=input.getBoundingClientRect();
 if(rect.bottom<=bottom&&rect.top>=top)return;
 const delta=rect.bottom>bottom?rect.bottom-bottom+12:rect.top-top-12;
 let parent=input.parentElement;
 while(parent&&parent!==document.body){if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight){parent.scrollBy({top:delta,behavior:'instant'});return;}parent=parent.parentElement;}
 window.scrollBy({top:delta,behavior:'instant'});
}
export default function KeyboardFocus(){useEffect(()=>{let frame=0;const reveal=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>revealFocusedInput());};document.addEventListener('focusin',reveal);window.addEventListener('resize',reveal);window.visualViewport?.addEventListener('resize',reveal);return()=>{cancelAnimationFrame(frame);document.removeEventListener('focusin',reveal);window.removeEventListener('resize',reveal);window.visualViewport?.removeEventListener('resize',reveal);};},[]);return null;}
