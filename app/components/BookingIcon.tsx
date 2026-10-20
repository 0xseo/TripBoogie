import {Plane,Hotel,Ticket,type LucideProps} from "lucide-react";
import TurtleIcon from "./TurtleIcon";
export default function BookingIcon({type,...props}:Omit<LucideProps,"type">&{type:unknown}){
 const Icon=type==="flight"?Plane:type==="hotel"?Hotel:type==="tour"?Ticket:TurtleIcon;
 return <Icon {...props}/>;
}
