/** Counts and checkmarks share one interpretation of the signed-in member's completion. */
export function checklistState(data:Record<string,unknown>,userId:string){
 const value=data.checks;
 const checks=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 return {checks,done:data.scope==="all"?!!checks[userId]:data.done===true};
}
