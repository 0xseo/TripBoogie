import {Turtle,type LucideProps} from "lucide-react";
/** The companion LookBoogie app offsets the turtle by 2px for optical centering. */
export default function TurtleIcon(props:LucideProps){return <Turtle {...props} style={{transform:"translateX(2px)",...props.style}}/>;}
