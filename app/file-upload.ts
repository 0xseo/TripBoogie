const fileTypes:Record<string,string>={pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",txt:"text/plain"};
export const fileUploadAccept=Object.keys(fileTypes).map(ext=>`.${ext}`).join(",");
export function fileUploadMetadata(file:Pick<File,"name"|"size"|"type">){
 if(!file.size||file.size>6291456)throw new Error("파일은 6 MiB 이하로 골라북");
 const mime=!file.type||file.type==="application/octet-stream"?fileTypes[file.name.split(".").at(-1)?.toLowerCase()||""]:file.type;
 if(!mime||!Object.values(fileTypes).includes(mime))throw new Error("PDF, 사진, DOCX, XLSX, TXT 파일을 골라북");
 return {name:file.name,mime,size:file.size};
}
type Prepared={id:string;path:string};
export async function uploadFileSelection(files:File[],hooks:{prepare:(metadata:ReturnType<typeof fileUploadMetadata>)=>Promise<Prepared>;store:(file:File,prepared:Prepared,mime:string)=>Promise<void>;finish:(id:string)=>Promise<unknown>;isCurrent:()=>boolean;onProgress:(current:number,total:number,name:string)=>void}){
 // Validate the whole selection before creating pending server records.
 const selection=files.map(file=>({file,metadata:fileUploadMetadata(file)}));
 let completed=0;
 for(const {file,metadata} of selection){
  if(!hooks.isCurrent())return;
  hooks.onProgress(completed+1,selection.length,file.name);
  try{
   const prepared=await hooks.prepare(metadata);
   await hooks.store(file,prepared,metadata.mime);
   await hooks.finish(prepared.id);
   completed++;
  }catch(error){
   const message=error instanceof Error?error.message:"파일을 올리지 못했어북";
   throw new Error(`${completed?`${completed}개 업로드 완료 · `:""}${file.name}: ${message}`);
  }
 }
}
export function isFileDrag(data:{types:readonly string[]}){return Array.from(data.types).includes("Files");}
