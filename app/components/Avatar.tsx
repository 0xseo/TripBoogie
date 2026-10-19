/* eslint-disable @next/next/no-img-element -- Small private avatars are returned by the member-authorized RPC. */
"use client";
import TurtleIcon from "./TurtleIcon";
export default function Avatar({name,src,className=""}:{name:string;src?:string;className?:string}) {
 return <span className={`avatar ${className}`}>{src?<img src={src} alt={name} onError={e=>{e.currentTarget.hidden=true;}}/>:<TurtleIcon size={18} aria-label={name}/>}</span>;
}
