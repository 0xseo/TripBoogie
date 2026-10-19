/** Legacy notes had a separate title. Preserve it once when merging into a single body. */
export function memoText(data:Record<string,unknown>) {
 const title=typeof data.title==="string"?data.title.trim():"",note=typeof data.note==="string"?data.note:"";
 return note&&title&&!note.startsWith(title)?`${title}\n${note}`:note||title;
}
