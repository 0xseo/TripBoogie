"use client";
import {useEffect,useRef,useState} from "react";
import {FileText,Download,Upload,LoaderCircle,Trash2,SlidersHorizontal,Tags} from "lucide-react";
import type {Workspace,TripFile} from "../types";
import {getSupabaseClient} from "../client-api";
import {saveDownload} from "../download";
import {fileUploadAccept,isFileDrag,uploadFileSelection} from "../file-upload";
import {fileTagCategories,fileSortOptions,visibleFiles,fileUploadedDate,type FileSort} from "../file-library";
import {useConfirm} from "./Confirmation";
import {Empty} from "./ui";
import ChoiceField from "./ChoiceField";
import FileTagPicker from "./FileTagPicker";
import AddButton from "./AddButton";
import FeatureToolbar from "./FeatureToolbar";
const bucket = "tripboogie-private";
export type FileCommand = (
  op: string,
  payload: Record<string, unknown>
) => Promise<{ file: TripFile; workspace: Workspace }>;
export async function removeFile(file: TripFile, command: FileCommand) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("로그인을 확인해 주세요.");
  await command("mark-file-delete", { id: file.id });
  const { error } = await client.storage.from(bucket).remove([file.path]);
  if (error)
    throw new Error(
      "파일을 지우지 못했어요. 예약에서 삭제를 다시 시도해 주세요."
    );
  return command("finish-file-delete", { id: file.id });
}
export default function Files({
  workspace,
  bookingId,
  readOnly,
  command,
}: {
  workspace: Workspace;
  bookingId?: string;
  readOnly: boolean;
  command: FileCommand;
}) {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null), uploading=useRef(false), alive=useRef(true), dragDepth=useRef(0),
    [busy, setBusy] = useState(false), [dragging,setDragging]=useState(false),
    [progress,setProgress]=useState(""), [error, setError] = useState(""),
    [sort,setSort]=useState<FileSort>("newest"),[filterTags,setFilterTags]=useState<string[]>([]),
    [filterOpen,setFilterOpen]=useState(false),[taggedFile,setTaggedFile]=useState<TripFile|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(bookingId)return;
    const guard=(event:DragEvent)=>{if(event.dataTransfer&&isFileDrag(event.dataTransfer))event.preventDefault();};
    window.addEventListener("dragover",guard);window.addEventListener("drop",guard);
    return()=>{window.removeEventListener("dragover",guard);window.removeEventListener("drop",guard);};
  },[bookingId]);
  const tags=fileTagCategories(workspace.trip.settings),activeFilters=filterTags.filter(id=>tags.some(tag=>tag.id===id));
  const allFiles=workspace.files.filter(f=>!bookingId||f.booking_id===bookingId),files=visibleFiles(allFiles,sort,activeFilters);
  async function upload(selected:File[]) {
    if(readOnly||busy||uploading.current||!selected.length)return;
    uploading.current=true;
    setError("");setBusy(true);
    try {
      const client=await getSupabaseClient();
      if(!client)throw new Error("로그인을 확인해북");
      await uploadFileSelection(selected,{
        isCurrent:()=>alive.current,
        onProgress:(current,total,name)=>{if(alive.current)setProgress(`${current}/${total} · ${name}`);},
        prepare:async metadata=>(await command("prepare-file",{bookingId,...metadata})).file,
        store:async(file,prepared,mime)=>{
          const {error}=await client.storage.from(bucket).upload(prepared.path,file,{upsert:false,contentType:mime,cacheControl:"0"});
          if(error)throw new Error("업로드를 완료하지 못했어북. 자료함에서 확인하거나 삭제 후 다시 올려북.");
        },
        finish:id=>command("finish-file",{id}),
      });
    } catch(e) { if(alive.current)setError((e as Error).message); }
    finally {
      uploading.current=false;
      if(alive.current){setBusy(false);setProgress("");if(input.current)input.current.value="";}
    }
  }
  async function download(file: TripFile) {
    setBusy(true);
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("로그인을 확인하세요.");
      const { data, error } = await client.storage
        .from(bucket)
        .download(file.path);
      if (error || !data) throw new Error("파일을 내려받지 못했어요.");
      await saveDownload(data, file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`files ${bookingId ? "" : "file-library"} ${dragging?"file-dragging":""}`} aria-busy={busy}
      onDragEnter={e=>{if(!isFileDrag(e.dataTransfer))return;e.preventDefault();e.stopPropagation();dragDepth.current++;if(!readOnly&&!busy)setDragging(true);}}
      onDragOver={e=>{if(!isFileDrag(e.dataTransfer))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=readOnly||busy?"none":"copy";}}
      onDragLeave={e=>{if(!dragDepth.current)return;e.preventDefault();e.stopPropagation();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}}
      onDrop={e=>{if(!isFileDrag(e.dataTransfer))return;e.preventDefault();e.stopPropagation();dragDepth.current=0;setDragging(false);void upload(Array.from(e.dataTransfer.files));}}
    >
      {bookingId ? <div className="file-heading">
        <strong>첨부파일</strong>
        <button className="secondary" aria-label="파일 추가" disabled={readOnly || busy} onClick={() => input.current?.click()}>
          {busy ? <LoaderCircle size={22} className="spinner" /> : <Upload size={17} />}
          <span>{busy ? "처리 중…" : "파일 올리기"}</span>
        </button>
      </div> : <FeatureToolbar action={<AddButton label="자료 추가" disabled={readOnly} loading={busy} onClick={() => input.current?.click()} />}><div className="file-library-controls"><ChoiceField label="자료 정렬" value={sort} options={fileSortOptions} onChange={v=>setSort(v as FileSort)}/><button type="button" className="icon file-filter" aria-label={`태그 필터${activeFilters.length?` · ${activeFilters.length}개 적용`:""}`} aria-expanded={filterOpen} onClick={()=>setFilterOpen(true)}><SlidersHorizontal size={20}/>{activeFilters.length>0&&<span>{activeFilters.length}</span>}</button></div></FeatureToolbar>}
        <input
          ref={input}
          type="file"
          hidden
          accept={fileUploadAccept}
          multiple
          disabled={readOnly||busy}
          onChange={e=>{void upload(Array.from(e.target.files||[]));}}
        />
      {!readOnly&&<p className="file-drop-hint"><Upload size={16}/>파일을 끌어놓아북</p>}
      {dragging&&<div className="file-drop-overlay" aria-hidden="true"><Upload size={30}/><span>놓으면 자료가 추가돼북</span></div>}
      {busy&&progress&&<p className="file-upload-status" role="status"><LoaderCircle size={16} className="spinner"/><span>{progress}</span></p>}
      {!bookingId && !files.length && <Empty title={activeFilters.length?"해당 자료가 없어북":"자료가 없어북"} />}
      {files.map((file) => (
        <article className="file-row" key={file.id}>
          <FileText size={22} />
          <div className="record-body">
            <strong>{file.name}</strong>
            <small>
              {(file.size / 1024).toFixed(0)} KB · {fileUploadedDate(file.created_at)} ·{" "}
              {file.status === "ready"
                ? (workspace.records.find((r) => r.id === file.booking_id)?.data
                    .title as string) || "여행 자료"
                : file.status === "pending"
                ? "업로드 확인 필요"
                : "삭제 대기 · 다시 시도 가능"}
            </small>
            {(file.tags??[]).length>0&&<div className="file-tags">{(file.tags??[]).map(id=><span key={id}>{tags.find(tag=>tag.id===id)?.label||id}</span>)}</div>}
          </div>
          {!readOnly&&<button type="button" className="icon" aria-label={`${file.name} 태그 수정`} disabled={busy||file.status==="deleting"} onClick={()=>setTaggedFile(file)}><Tags size={18}/></button>}
          {file.status === "ready" ? (
            <button
              className="icon"
              aria-label={`${file.name} 다운로드`}
              disabled={busy}
              onClick={() => void download(file)}
            >
              <Download size={19} />
            </button>
          ) : (
            file.status === "pending" &&
            !readOnly && (
              <button
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await command("finish-file", { id: file.id });
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                업로드 확인
              </button>
            )
          )}
          <button
            className="icon"
            aria-label={`${file.name} 삭제`}
            disabled={readOnly || busy}
            onClick={async () => {
              if (!(await confirm(`“${file.name}” 파일을 삭제할까요?`))) return;
              setBusy(true);
              try {
                await removeFile(file, command);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={17} />
          </button>
        </article>
      ))}
      {filterOpen&&<FileTagPicker title="태그 필터" tags={tags} selected={activeFilters} onClose={()=>setFilterOpen(false)} onSave={async ids=>setFilterTags(ids)}/>}
      {taggedFile&&<FileTagPicker title="자료 태그" tags={tags} selected={taggedFile.tags??[]} onClose={()=>setTaggedFile(null)} onSave={async ids=>{await command("set-file-tags",{id:taggedFile.id,version:taggedFile.version??1,tags:ids});}}/>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
