"use client";
import {createContext,useContext,useState,type ComponentProps,type SubmitEvent} from "react";
import {revealFocusedInput} from "./KeyboardFocus";
const Errors=createContext<Record<string,string>>({});
export const useFieldError=(id:string)=>useContext(Errors)[id];
type Control=HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
export function validationMessage(input:Control,label:string){
 const v=input.validity;
 if(v.valueMissing||input.required&&!input.value.trim())return `${label} 입력해 주세요.`;
 if(v.typeMismatch)return input instanceof HTMLInputElement&&input.type==="email"?"이메일 주소를 확인해 주세요.":`${label} 형식을 확인해 주세요.`;
 if(v.rangeUnderflow)return `${label} ${(input as HTMLInputElement).min} 이상으로 입력해 주세요.`;
 if(v.rangeOverflow)return `${label} ${(input as HTMLInputElement).max} 이하로 입력해 주세요.`;
 if(v.tooLong)return `${label} ${(input as HTMLInputElement).maxLength}자 이내로 입력해 주세요.`;
 if(v.badInput||v.stepMismatch)return `${label} 올바른 숫자로 입력해 주세요.`;
 if(!v.valid)return `${label} 확인해 주세요.`;
 return "";
}
export default function Form({children,onSubmit,onInputCapture,...props}:ComponentProps<"form">){
 const [errors,setErrors]=useState<Record<string,string>>({}),[summary,setSummary]=useState("");
 function submit(e:SubmitEvent<HTMLFormElement>){
  const next:Record<string,string>={};let first:Control|undefined,unplaced="";
  for(const element of Array.from(e.currentTarget.elements)){
   if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement)||!element.willValidate)continue;
   const field=element.closest<HTMLElement>("[data-validation-field]"),key=field?.dataset.validationField;
   const label=field?.dataset.validationLabel||element.getAttribute("aria-label")||element.labels?.[0]?.querySelector("span")?.textContent||"필수 항목을";
   const message=validationMessage(element,label.replace(/\s*[··]\s*선택.*/,""));
   if(message){first??=element;element.setAttribute("aria-invalid","true");if(key){next[key]=message;element.setAttribute("aria-describedby",key);}else unplaced||=message;}
   else{element.removeAttribute("aria-invalid");if(element.getAttribute("aria-describedby")===key)element.removeAttribute("aria-describedby");}
  }
  setErrors(next);setSummary(unplaced);
  if(first){e.preventDefault();first.focus();requestAnimationFrame(()=>revealFocusedInput(first?.closest("dialog")||undefined));return;}
  onSubmit?.(e);
 }
 return <Errors.Provider value={errors}><form {...props} noValidate onSubmit={submit} onInputCapture={e=>{
  onInputCapture?.(e);const input=e.target as HTMLElement,key=input.closest<HTMLElement>("[data-validation-field]")?.dataset.validationField;
  input.removeAttribute("aria-invalid");if(key){input.removeAttribute("aria-describedby");setErrors(current=>{if(!current[key])return current;const next={...current};delete next[key];return next;});}setSummary("");
 }}>{summary&&<p className="form-validation-summary" role="alert">{summary}</p>}{children}</form></Errors.Provider>;
}
