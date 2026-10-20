"use client";
import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Download,
  Upload,
  LoaderCircle,
  Trash2,
  SlidersHorizontal,
  Tags,
  Eye,
  Search,
} from "lucide-react";
import type { Workspace, TripFile } from "../types";
import { getSupabaseClient } from "../client-api";
import { saveDownload } from "../download";
import {
  fileUploadAccept,
  isFileDrag,
  uploadFileSelection,
} from "../file-upload";
import {
  fileTagCategories,
  fileSortOptions,
  visibleFiles,
  fileUploadedDate,
  type FileSort,
} from "../file-library";
import { useConfirm } from "./Confirmation";
import { Empty } from "./ui";
import ChoiceField from "./ChoiceField";
import FileTagPicker from "./FileTagPicker";
import FilePreview from "./FilePreview";
import AddButton from "./AddButton";
import FeatureToolbar from "./FeatureToolbar";
const bucket = "tripboogie-private";
export type FileCommand = (
  op: string,
  payload: Record<string, unknown>,
) => Promise<{ file: TripFile | null; workspace: Workspace }>;
export async function removeFile(file: TripFile, command: FileCommand) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("로그인을 확인해 주세요.");
  await command("mark-file-delete", { id: file.id });
  const { error } = await client.storage.from(bucket).remove([file.path]);
  if (error)
    throw new Error(
      "파일을 지우지 못했어요. 예약에서 삭제를 다시 시도해 주세요.",
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
  const input = useRef<HTMLInputElement>(null),
    uploading = useRef(false),
    alive = useRef(true),
    dragDepth = useRef(0),
    [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [sort, setSort] = useState<FileSort>("newest"),
    [filterTags, setFilterTags] = useState<string[]>([]),
    [filterOpen, setFilterOpen] = useState(false),
    [taggedFile, setTaggedFile] = useState<TripFile | null>(null),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [bulkTags, setBulkTags] = useState(false),
    [preview, setPreview] = useState<TripFile | null>(null),
    [box, setBox] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    } | null>(null);
  const list = useRef<HTMLDivElement>(null),
    gesture = useRef<{
      x: number;
      y: number;
      active: boolean;
      initial: string[];
    } | null>(null),
    suppressClick = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (bookingId) return;
    const guard = (event: DragEvent) => {
      if (event.dataTransfer && isFileDrag(event.dataTransfer))
        event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [bookingId]);
  const tags = fileTagCategories(workspace.trip.settings),
    activeFilters = filterTags.filter((id) =>
      tags.some((tag) => tag.id === id),
    );
  const allFiles = workspace.files.filter(
      (f) => !bookingId || f.booking_id === bookingId,
    ),
    files = visibleFiles(allFiles, sort, activeFilters, query);
  const picked = allFiles.filter((f) => selected.includes(f.id)),
    batchFiles = picked.length ? picked : files;
  async function deleteBatch() {
    if (readOnly || busy || !batchFiles.length) return;
    if (
      !(await confirm(
        `${picked.length ? "선택한" : "현재 목록의"} 파일 ${batchFiles.length}개를 삭제할까요?`,
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("로그인을 확인해 주세요.");
      const targets = batchFiles.map((f) => ({
        id: f.id,
        version: f.version ?? 1,
      }));
      await command("mark-files-delete", { files: targets });
      const result = await client.storage
        .from(bucket)
        .remove(batchFiles.map((f) => f.path));
      if (result.error)
        throw new Error(
          "일부 파일 삭제를 완료하지 못했어요. 선택 삭제를 다시 시도해 주세요.",
        );
      await command("finish-files-delete", { files: targets });
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function selectFile(id: string) {
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
    );
  }
  async function upload(selected: File[]) {
    if (readOnly || busy || uploading.current || !selected.length) return;
    uploading.current = true;
    setError("");
    setBusy(true);
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("로그인을 확인해북");
      await uploadFileSelection(selected, {
        isCurrent: () => alive.current,
        onProgress: (current, total, name) => {
          if (alive.current) setProgress(`${current}/${total} · ${name}`);
        },
        prepare: async (metadata) => {
          const file = (
            await command("prepare-file", { bookingId, ...metadata })
          ).file;
          if (!file) throw new Error("파일 준비 결과를 확인하지 못했어요.");
          return file;
        },
        store: async (file, prepared, mime) => {
          const { error } = await client.storage
            .from(bucket)
            .upload(prepared.path, file, {
              upsert: false,
              contentType: mime,
              cacheControl: "0",
            });
          if (error)
            throw new Error(
              "업로드를 완료하지 못했어북. 자료함에서 확인하거나 삭제 후 다시 올려북.",
            );
        },
        finish: (id) => command("finish-file", { id }),
      });
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      uploading.current = false;
      if (alive.current) {
        setBusy(false);
        setProgress("");
        if (input.current) input.current.value = "";
      }
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
    <div
      className={`files ${bookingId ? "" : "file-library"} ${dragging ? "file-dragging" : ""}`}
      aria-busy={busy}
      onDragEnter={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current++;
        if (!readOnly && !busy) setDragging(true);
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = readOnly || busy ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!dragDepth.current) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      {bookingId ? (
        <div className="file-heading">
          <strong>첨부파일</strong>
          <button
            className="secondary"
            aria-label="파일 추가"
            disabled={readOnly || busy}
            onClick={() => input.current?.click()}
          >
            {busy ? (
              <LoaderCircle size={22} className="spinner" />
            ) : (
              <Upload size={17} />
            )}
            <span>{busy ? "처리 중…" : "파일 올리기"}</span>
          </button>
        </div>
      ) : (
        <FeatureToolbar
          action={
            <AddButton
              label="자료 추가"
              disabled={readOnly}
              loading={busy}
              onClick={() => input.current?.click()}
            />
          }
        >
          <div className="file-library-controls">
            <strong className="file-count">자료 {allFiles.length}개</strong>
            <ChoiceField
              label="자료 정렬"
              value={sort}
              options={fileSortOptions}
              onChange={(v) => setSort(v as FileSort)}
            />
            <button
              type="button"
              className="icon file-filter"
              aria-label={`태그 필터${activeFilters.length ? ` · ${activeFilters.length}개 적용` : ""}`}
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(true)}
            >
              <SlidersHorizontal size={20} />
              {activeFilters.length > 0 && <span>{activeFilters.length}</span>}
            </button>
          </div>
        </FeatureToolbar>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={fileUploadAccept}
        multiple
        disabled={readOnly || busy}
        onChange={(e) => {
          void upload(Array.from(e.target.files || []));
        }}
      />
      {!bookingId && (
        <div className="file-management-bar">
          <label className="file-search">
            <Search size={18} />
            <input
              aria-label="자료 검색"
              placeholder="파일 이름 검색"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected([]);
              }}
            />
          </label>
          <div className="file-bulk-actions">
            <label>
              <input
                type="checkbox"
                aria-label="현재 목록 전체 선택"
                checked={
                  !!files.length && files.every((f) => selected.includes(f.id))
                }
                disabled={!files.length || busy}
                onChange={(e) =>
                  setSelected(e.target.checked ? files.map((f) => f.id) : [])
                }
              />
              {picked.length ? `${picked.length}개 선택` : `${files.length}개`}
            </label>
            <button
              type="button"
              className="text-button"
              disabled={readOnly || busy || !batchFiles.length}
              onClick={() => setBulkTags(true)}
            >
              <Tags size={16} />
              {picked.length ? "선택 태그 이동" : "전체 태그 이동"}
            </button>
            <button
              type="button"
              className="text-button danger-text"
              disabled={readOnly || busy || !batchFiles.length}
              onClick={() => void deleteBatch()}
            >
              <Trash2 size={16} />
              {picked.length ? "선택 삭제" : "전체 삭제"}
            </button>
          </div>
        </div>
      )}
      {!readOnly && (
        <p className="file-drop-hint">
          <Upload size={16} />
          파일을 끌어놓아북
        </p>
      )}
      {dragging && (
        <div className="file-drop-overlay" aria-hidden="true">
          <Upload size={30} />
          <span>놓으면 자료가 추가돼북</span>
        </div>
      )}
      {busy && progress && (
        <p className="file-upload-status" role="status">
          <LoaderCircle size={16} className="spinner" />
          <span>{progress}</span>
        </p>
      )}
      {!bookingId && !files.length && (
        <Empty
          title={activeFilters.length ? "해당 자료가 없어북" : "자료가 없어북"}
        />
      )}
      <div
        className="file-list"
        ref={list}

        onClickCapture={(e) => {
          if (Date.now() < suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerDown={(e) => {
          if (
            bookingId ||
            e.pointerType !== "mouse" ||
            e.button !== 0 ||
            busy ||
            (e.target as Element).closest("button,input,a,label")
          )
            return;
          e.preventDefault();
          gesture.current = {
            x: e.clientX,
            y: e.clientY,
            active: false,
            initial: e.ctrlKey || e.metaKey || e.shiftKey ? selected : [],
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = gesture.current,
            root = list.current;
          if (!g || !root) return;
          if (!g.active && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5)
            return;
          g.active = true;
          e.preventDefault();
          const left = Math.min(g.x, e.clientX),
            top = Math.min(g.y, e.clientY),
            right = Math.max(g.x, e.clientX),
            bottom = Math.max(g.y, e.clientY),
            r = root.getBoundingClientRect();
          setBox({
            left: left - r.left,
            top: top - r.top,
            width: right - left,
            height: bottom - top,
          });
          const ids = Array.from(
            root.querySelectorAll<HTMLElement>("[data-file-id]"),
          )
            .filter((el) => {
              const b = el.getBoundingClientRect();
              return (
                b.right >= left &&
                b.left <= right &&
                b.bottom >= top &&
                b.top <= bottom
              );
            })
            .map((el) => el.dataset.fileId!);
          setSelected([...new Set([...g.initial, ...ids])]);
        }}
        onPointerUp={(e) => {
          if (gesture.current?.active) {
            suppressClick.current = Date.now() + 300;
            e.preventDefault();
          }
          gesture.current = null;
          setBox(null);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setBox(null);
        }}
      >
        {files.map((file) => (
          <article
            className="file-row"
            key={file.id}
            data-file-id={file.id}
            data-selected={selected.includes(file.id)}
          >
            {!bookingId && (
              <input
                type="checkbox"
                aria-label={`${file.name} 선택`}
                checked={selected.includes(file.id)}
                disabled={busy}
                onChange={() => selectFile(file.id)}
              />
            )}
            <FileText size={22} />
            <div className="record-body">
              <button
                type="button"
                className="file-name"
                disabled={file.status !== "ready" || busy}
                onClick={() => setPreview(file)}
              >
                {file.name}
              </button>
              <small>
                {(file.size / 1024).toFixed(0)} KB ·{" "}
                {fileUploadedDate(file.created_at)} ·{" "}
                {file.status === "ready"
                  ? (workspace.records.find((r) => r.id === file.booking_id)
                      ?.data.title as string) || "여행 자료"
                  : file.status === "pending"
                    ? "업로드 확인 필요"
                    : "삭제 대기 · 다시 시도 가능"}
              </small>
              {(file.tags ?? []).length > 0 && (
                <div className="file-tags">
                  {(file.tags ?? []).map((id) => (
                    <span key={id}>
                      {tags.find((tag) => tag.id === id)?.label || id}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {!readOnly && (
              <button
                type="button"
                className="icon"
                aria-label={`${file.name} 태그 수정`}
                disabled={busy || file.status === "deleting"}
                onClick={() => setTaggedFile(file)}
              >
                <Tags size={18} />
              </button>
            )}
            {file.status === "ready" && (
              <button
                type="button"
                className="icon"
                aria-label={`${file.name} 미리보기`}
                disabled={busy}
                onClick={() => setPreview(file)}
              >
                <Eye size={19} />
              </button>
            )}
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
                if (!(await confirm(`“${file.name}” 파일을 삭제할까요?`)))
                  return;
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
        {box && (
          <div className="file-selection-box" style={box} aria-hidden="true" />
        )}
      </div>
      {preview && (
        <FilePreview file={preview} onClose={() => setPreview(null)} />
      )}
      {bulkTags && (
        <FileTagPicker
          title={`${batchFiles.length}개 자료 태그 이동`}
          tags={tags}
          selected={[]}
          onClose={() => setBulkTags(false)}
          onSave={async (ids) => {
            await command("set-files-tags", {
              files: batchFiles.map((f) => ({
                id: f.id,
                version: f.version ?? 1,
              })),
              tags: ids,
            });
            setSelected([]);
          }}
        />
      )}
      {filterOpen && (
        <FileTagPicker
          title="태그 필터"
          tags={tags}
          selected={activeFilters}
          onClose={() => setFilterOpen(false)}
          onSave={async (ids) => {
            setFilterTags(ids);
            setSelected([]);
          }}
        />
      )}
      {taggedFile && (
        <FileTagPicker
          title="자료 태그"
          tags={tags}
          selected={taggedFile.tags ?? []}
          onClose={() => setTaggedFile(null)}
          onSave={async (ids) => {
            await command("set-file-tags", {
              id: taggedFile.id,
              version: taggedFile.version ?? 1,
              tags: ids,
            });
          }}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
