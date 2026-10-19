import type {Profile} from "./types";
import {profileUpdate} from "./profile-update";
/** One owner keeps confirmed server values separate from an in-flight preference edit. */
export class ProfileState {
  private confirmed:Profile|null;
  private snapshot:Profile|null;
  private pending:{id:string;patch:Record<string,unknown>}|null=null;
  private listeners=new Set<()=>void>();
  constructor(initial:Profile|null){this.confirmed=initial;this.snapshot=initial;}
  getSnapshot=()=>this.snapshot;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(){
    this.snapshot=this.confirmed&&this.pending?.id===this.confirmed.id?{...this.confirmed,...this.pending.patch}:this.confirmed;
    this.listeners.forEach(listener=>listener());
  }
  receive=(next:Profile|null)=>{
    if(next&&this.confirmed?.id===next.id&&next.version<this.confirmed.version)return;
    if(next?.id!==this.confirmed?.id)this.pending=null;
    this.confirmed=next;this.publish();
  };
  async save(changes:Record<string,unknown>,persist:(payload:Record<string,unknown>)=>Promise<Profile>){
    const before=this.confirmed;
    if(!before)throw new Error("로그인을 확인해북.");
    if(this.pending)throw new Error("앞선 변경을 저장하고 있어북.");
    const payload=profileUpdate(before,changes);
    const patch={...payload};delete patch.version;
    const edit={id:before.id,patch};
    this.pending=edit;this.publish();
    try{
      const saved=await persist(payload);
      if(this.pending!==edit||this.confirmed?.id!==edit.id)return;
      if(saved.id!==edit.id)throw new Error("계정이 바뀌었어북. 다시 확인해북.");
      this.pending=null;
      if(saved.version>=this.confirmed.version)this.confirmed=saved;
      this.publish();
    }catch(error){
      if(this.pending===edit){this.pending=null;this.publish();}
      throw error;
    }
  }
}
