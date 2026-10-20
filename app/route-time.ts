import type {Connection} from "./route-graph";
import type {ItemRecord} from "./types";
export type SaveTravelTime=(plan:ItemRecord,fromId:string,key:string,mode:string,minutes:number)=>Promise<void>;
export function travelEstimateKey(mode:string,fromId:string,toId:string,from:{lat:number;lng:number},to:{lat:number;lng:number}){
 return JSON.stringify([mode,fromId,toId,from.lat,from.lng,to.lat,to.lng]);
}
export function connectionEstimateKey(connection:Connection,mode:string){
 return connection.leg?travelEstimateKey(mode,connection.from.id,connection.to.id,connection.leg.from,connection.leg.to):"";
}
export function savedTravelMinutes(connection:Connection,mode:string){
 const data=connection.to.data,value=data.travelMinutes;
 if(data.travelFromId!==connection.from.id||value===undefined||value===null)return "";
 if(data.travelTimeSource==="estimate"&&data.travelEstimateKey!==connectionEstimateKey(connection,mode))return "";
 return String(value);
}
