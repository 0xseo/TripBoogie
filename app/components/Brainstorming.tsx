"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Check,
  FileSpreadsheet,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { getSupabaseClient } from "../client-api";
import { brainService, type BrainService } from "../brainstorm-client";
import {
  type BrainKind,
  type BrainSummary,
  type CellValue,
} from "../brainstorm";
import type { BrainStore } from "../brainstorm-store";
import type { Workspace } from "../types";
import { useConfirm } from "./Confirmation";
import Dialog from "./Dialog";
import AddButton from "./AddButton";
import ListControls from "./ListControls";
import ChoiceField from "./ChoiceField";
import BrainSheet from "./BrainSheet";
import BrainBoard, { BoardPreview } from "./BrainBoard";
import styles from "./Brainstorming.module.css";

type Participant = {
  userId: string;
  name: string;
  documentId: string;
  cell?: string;
};
type OpenDocument = { id: string; store: BrainStore };
const kindName = (kind: BrainKind) =>
  kind === "sheet" ? "스프레드시트" : "캔버스";
function SheetPreview({ preview }: { preview: BrainSummary["preview"] }) {
  return (
    <div className={styles.sheetPreview} aria-hidden="true">
      <div className={styles.previewLetters}>
        <span />
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
      </div>
      {Array.from({ length: 5 }, (_, r) => (
        <div key={r}>
          <span>{r + 1}</span>
          {Array.from({ length: 4 }, (_, c) => {
            const value = preview[`${r}:${c}`] as CellValue | undefined;
            return (
              <span
                key={c}
                style={{
                  background: value?.background,
                  color: value?.color,
                  fontWeight: value?.bold ? 700 : undefined,
                }}
              >
                {value?.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
export default function Brainstorming({
  workspace,
  accountId,
  disabled,
  service: customService,
}: {
  workspace: Workspace;
  accountId: string;
  disabled: boolean;
  service?: BrainService;
}) {
  const service = useMemo(
    () => customService ?? brainService(accountId, workspace.trip.id),
    [customService, accountId, workspace.trip.id]
  );
  const [documents, setDocuments] = useState<BrainSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [trash, setTrash] = useState(false),
    [active, setActive] = useState<string | null>(null),
    [opened, setOpened] = useState<OpenDocument[]>([]);
  const [query, setQuery] = useState(""), [order, setOrder] = useState("updated"), [pickingKind, setPickingKind] = useState(false);
  const [opening, setOpening] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [create, setCreate] = useState<{
      id: string;
      kind: BrainKind;
      title: string;
    } | null>(null),
    [renaming, setRenaming] = useState<BrainSummary | null>(null),
    [name, setName] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]),
    channel = useRef<RealtimeChannel | null>(null);
  const openRef = useRef(opened),
    activeRef = useRef(active),
    request = useRef(0),
    confirm = useConfirm();
  useLayoutEffect(() => {
    openRef.current = opened;
    activeRef.current = active;
  }, [opened, active]);
  const load = useCallback(async () => {
    const next = await service.list();
    setDocuments(next);
    setError("");
  }, [service]);
  const refresh = useCallback(async () => {
    await load();
    await Promise.all(openRef.current.map((d) => d.store.refresh()));
  }, [load]);
  useEffect(() => {
    const pulled = (event: Event) => {
      (event as CustomEvent<{ waitUntil: (update: Promise<unknown>) => void }>).detail.waitUntil(
        refresh().catch(error => setError((error as Error).message))
      );
    };
    window.addEventListener("tripboogie:refresh", pulled);
    return () => window.removeEventListener("tripboogie:refresh", pulled);
  }, [refresh]);
  useEffect(() => {
    let alive = true;
    void service
      .list()
      .then((next) => {
        if (alive) {
          setDocuments(next);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch((e) => setError((e as Error).message));
    }, 5000);
    const foreground = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    };
    window.addEventListener("online", foreground);
    window.addEventListener("tripboogie:foreground", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      alive = false;
      clearInterval(poll);
      window.removeEventListener("online", foreground);
      window.removeEventListener("tripboogie:foreground", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [refresh, service]);
  useEffect(() => {
    if (customService) {
      const changed = () => {
        void refresh().catch(() => {});
      };
      const stored = (e: StorageEvent) => {
        if (e.key === "tripboogie:brain-preview:v1") changed();
      };
      window.addEventListener("brain-preview-changed", changed);
      window.addEventListener("storage", stored);
      return () => {
        window.removeEventListener("brain-preview-changed", changed);
        window.removeEventListener("storage", stored);
      };
    }
    let alive = true,
      unsubscribe: (() => void) | undefined;
    void getSupabaseClient()
      .then((client) => {
        if (!client || !alive) return;
        const room = client.channel(`brain:${workspace.trip.id}`, {
          config: {
            private: true,
            presence: { key: `${accountId}:${crypto.randomUUID()}` },
          },
        });
        channel.current = room;
        room
          .on("broadcast", { event: "changed" }, () => {
            void refresh().catch(() => {});
          })
          .on("presence", { event: "sync" }, () => {
            if (!alive) return;
            const members = Object.values(room.presenceState<Participant>())
              .flat()
              .filter(
                (p) =>
                  typeof p.userId === "string" &&
                  typeof p.name === "string" &&
                  typeof p.documentId === "string"
              );
            setParticipants(members);
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED")
              void room.track({
                userId: accountId,
                name:
                  workspace.members.find((m) => m.id === accountId)?.name ||
                  "동행",
                documentId: activeRef.current || "",
              });
          });
        unsubscribe = () => {
          channel.current = null;
          void client.removeChannel(room);
        };
      })
      .catch(() => {});
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [accountId, workspace.trip.id, workspace.members, customService, refresh]);
  const presence = useCallback(
    (cell?: string) => {
      if (channel.current)
        void channel.current.track({
          userId: accountId,
          name:
            workspace.members.find((m) => m.id === accountId)?.name || "동행",
          documentId: activeRef.current || "",
          cell: cell || "",
        });
    },
    [accountId, workspace.members]
  );
  useEffect(() => {
    presence();
  }, [active, presence]);
  useEffect(() => {
    const changed = (event: BeforeUnloadEvent) => {
      if (openRef.current.some((d) => d.store.getSnapshot().pending)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", changed);
    return () => window.removeEventListener("beforeunload", changed);
  }, []);
  const open = async (doc: BrainSummary) => {
    const epoch = ++request.current;
    setOpening(doc.id);
    setError("");
    try {
      const store = await service.open(doc.id);
      if (epoch !== request.current) return;
      setOpened((all) =>
        all.some((d) => d.id === doc.id) ? all : [...all, { id: doc.id, store }]
      );
      setActive(doc.id);
    } catch (e) {
      if (epoch === request.current) setError((e as Error).message);
    } finally {
      if (epoch === request.current) setOpening(null);
    }
  };
  const metadata = async (
    doc: BrainSummary,
    action: string,
    title?: string
  ) => {
    if (disabled || busy) return;
    if (
      openRef.current.find((d) => d.id === doc.id)?.store.getSnapshot().pending
    ) {
      setError("문서의 미저장 변경을 먼저 확인해 주세요.");
      return;
    }
    if (
      action === "purge" &&
      !(await confirm(`“${doc.title}”을 영구 삭제할까요? 복원할 수 없습니다.`, {
        title: "문서 영구 삭제",
        confirmLabel: "영구 삭제",
      }))
    )
      return;
    setBusy(true);
    try {
      await service.meta(doc, action, title);
      setRenaming(null);
      if (action === "purge") {
        setOpened((all) => all.filter((d) => d.id !== doc.id));
        await load();
      } else await refresh();
    } catch (e) {
      await load().catch(() => {});
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const search = query.trim().toLocaleLowerCase("ko-KR");
  const visible = documents.filter(d => (trash ? !!d.deletedAt : !d.deletedAt) && `${d.title} ${kindName(d.kind)}`.toLocaleLowerCase("ko-KR").includes(search)).sort((a, b) => {
    if (order === "name") return a.title.localeCompare(b.title, "ko") || a.id.localeCompare(b.id);
    if (order === "kind") return a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, "ko") || a.id.localeCompare(b.id);
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
  const selected = opened.find(d => d.id === active);
  return (
    <section className={styles.library} aria-label="브레인스토밍">
      <div className={styles.libraryControls}>
        <ListControls label="문서" query={query} onQuery={setQuery} order={order} onOrder={setOrder} count={visible.length}
          options={[{ id: "updated", label: "최근 수정순" }, { id: "name", label: "이름순" }, { id: "kind", label: "종류순" }]} />
        <button type="button" className={styles.trashToggle} aria-pressed={trash} onClick={() => setTrash(v => !v)}>
          {trash ? <FolderOpen size={17}/> : <Trash2 size={17}/>}
          {trash ? "문서로 돌아가기" : `휴지통${documents.some(d => d.deletedAt) ? ` ${documents.filter(d => d.deletedAt).length}` : ""}`}
        </button>
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button
            onClick={() =>
              void refresh().catch((e) => setError((e as Error).message))
            }
          >
            다시 시도
          </button>
        </div>
      )}
      {loading ? (
        <p className={styles.loading} role="status">
          <LoaderCircle className="spinner" size={20} />
          문서를 불러오고 있어요
        </p>
      ) : visible.length ? (
        <div className={styles.documentGrid}>
          {visible.map((doc) => (
            <article key={doc.id} className={styles.documentCard}>
              <button
                className={styles.openDocument}
                disabled={!!doc.deletedAt || !!opening}
                onClick={() => void open(doc)}
                aria-label={`${doc.title} ${kindName(doc.kind)} 열기`}
              >
                <div className={styles.thumbnail}>
                  {doc.kind === "sheet" ? (
                    <SheetPreview preview={doc.preview} />
                  ) : (
                    <BoardPreview preview={doc.preview} id={doc.id} />
                  )}
                </div>
                <div className={styles.documentInfo}>
                  <span className={styles.kindLabel}>
                    {doc.kind === "sheet" ? (
                      <FileSpreadsheet size={13} />
                    ) : (
                      <Pencil size={13} />
                    )}{" "}
                    {kindName(doc.kind)}
                  </span>
                  <strong>{doc.title}</strong>
                  <small>
                    {opening === doc.id
                      ? "여는 중…"
                      : `${new Date(doc.updatedAt).toLocaleString("ko-KR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })} 수정`}
                  </small>
                </div>
              </button>
              {!disabled && (
                <div className={styles.cardActions}>
                  {doc.deletedAt ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => void metadata(doc, "restore")}
                      >
                        <RotateCcw size={15} />
                        복원
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void metadata(doc, "purge")}
                      >
                        영구 삭제
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRenaming(doc);
                          setName(doc.title);
                        }}
                      >
                        이름 변경
                      </button>
                      <button
                        disabled={busy}
                        aria-label={`${doc.title} 휴지통으로 이동`}
                        onClick={() => void metadata(doc, "delete")}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        !loading && (
          <div className={styles.empty}>
            <FolderOpen size={38} />
            <p>{search ? "검색 결과가 없습니다." : trash ? "휴지통이 비어 있어요." : "문서가 없습니다."}</p>
          </div>
        )
      )}
      {!trash && !disabled && !active && <div className={styles.createButton}><AddButton label="새 문서 추가" onClick={() => setPickingKind(true)}/></div>}
      {pickingKind && <Dialog title="새 문서" onClose={() => setPickingKind(false)}>
        <div className={styles.kindOptions}>
          {(["sheet", "board"] as const).map(kind => <button type="button" key={kind} onClick={() => {
            setPickingKind(false); setCreate({ id: crypto.randomUUID(), kind, title: `새 ${kindName(kind)}` });
          }}>{kind === "sheet" ? <FileSpreadsheet size={25}/> : <Pencil size={25}/>}<span>{kindName(kind)}</span></button>)}
        </div>
      </Dialog>}
      {create && (
        <Dialog
          title={`${kindName(create.kind)} 만들기`}
          onClose={() => !busy && setCreate(null)}
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const doc = await service.create(
                  create.kind,
                  create.title.trim(),
                  create.id
                );
                setCreate(null);
                await load();
                await open(doc);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              문서 이름
              <input
                autoFocus
                maxLength={100}
                value={create.title}
                onChange={(e) =>
                  setCreate({ ...create, title: e.target.value })
                }
              />
            </label>
            <button className="primary" disabled={busy || !create.title.trim()}>
              {busy ? "만드는 중…" : "만들고 열기"}
            </button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </form>
        </Dialog>
      )}
      {renaming && (
        <Dialog
          title="문서 이름 변경"
          onClose={() => !busy && setRenaming(null)}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void metadata(renaming, "rename", name.trim());
            }}
          >
            <label>
              문서 이름
              <input
                autoFocus
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !name.trim()}>
              저장
            </button>
          </form>
        </Dialog>
      )}
      {selected && (
        <BrainEditor
          active={selected}
          opened={opened}
          documents={documents.filter((d) => !d.deletedAt)}
          disabled={disabled}
          participants={participants.filter(
            (p) => p.documentId === active && p.userId !== accountId
          )}
          onClose={() => {
            setActive(null);
            void load().catch(() => {});
          }}
          onOpen={(doc) => void open(doc)}
          onCell={presence}
        />
      )}
    </section>
  );
}

function BrainEditor({
  active,
  opened,
  documents,
  disabled,
  participants,
  onClose,
  onOpen,
  onCell,
}: {
  active: OpenDocument;
  opened: OpenDocument[];
  documents: BrainSummary[];
  disabled: boolean;
  participants: Participant[];
  onClose: () => void;
  onOpen: (doc: BrainSummary) => void;
  onCell: (label: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    snapshot = useSyncExternalStore(
      active.store.subscribe,
      active.store.getSnapshot,
      active.store.getSnapshot
    ),
    confirm = useConfirm();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const viewport = window.visualViewport;
    const fit = () => {
      dialog.style.height = `${viewport?.height || window.innerHeight}px`;
      dialog.style.top = `${viewport?.offsetTop || 0}px`;
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);
  const error = snapshot.error;
  return createPortal(
    <dialog
      ref={ref}
      className={styles.editor}
      aria-label="브레인스토밍 전체 화면 편집"
      data-no-pull-refresh
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "z" &&
          !(e.target as HTMLElement).matches("input,textarea")
        ) {
          e.preventDefault();
          void active.store.undo(e.shiftKey);
        }
      }}
    >
      <header className={styles.editorHeader}>
        <button
          className={styles.backButton}
          aria-label="문서 목록으로 돌아가기"
          onClick={onClose}
        >
          <ArrowLeft size={20} />
        </button>
        <div className={styles.editorTitle}>
          <strong>{snapshot.document.title}</strong>
          <span role="status">
            {snapshot.pending ? (
              <>
                <LoaderCircle size={12} className="spinner" />
                {snapshot.conflict
                  ? "변경 충돌 · 내 변경 보관 중"
                  : snapshot.error
                  ? "미저장 변경 보관 중"
                  : "저장 중…"}
              </>
            ) : snapshot.error ? (
              <>연결 확인 필요</>
            ) : (
              <>
                <Check size={12} />
                저장됨
              </>
            )}
            {disabled && " · 읽기 전용"}
          </span>
        </div>
        <div className={styles.documentPicker}>
          <ChoiceField
            label="브레인스토밍 문서 전환"
            value={active.id}
            options={[
              snapshot.document,
              ...documents.filter((d) => d.id !== active.id),
            ].map((d) => ({
              id: d.id,
              label: d.title,
              icon:
                d.kind === "sheet" ? (
                  <FileSpreadsheet size={16} />
                ) : (
                  <Pencil size={16} />
                ),
            }))}
            onChange={(id) => {
              const doc = documents.find((d) => d.id === id);
              if (doc) onOpen(doc);
            }}
          />
        </div>
        <div className={styles.editorActions}>
          <button
            disabled={disabled || !snapshot.canUndo}
            aria-label="실행 취소"
            title="실행 취소"
            onClick={() => void active.store.undo()}
          >
            <Undo2 size={19} />
          </button>
          <button
            disabled={disabled || !snapshot.canRedo}
            aria-label="다시 실행"
            title="다시 실행"
            onClick={() => void active.store.undo(true)}
          >
            <Redo2 size={19} />
          </button>
          <button aria-label="편집 닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </header>
      {participants.length > 0 && (
        <div className={styles.presence} aria-label="함께 편집 중인 동행">
          {participants.slice(0, 8).map((p, i) => (
            <span key={`${p.userId}:${i}`}>
              <i />
              {p.name.slice(0, 30)}
              {p.cell ? ` · ${p.cell.slice(0, 20)}` : ""}
            </span>
          ))}{" "}
          함께 보고 있어요
        </div>
      )}
      {snapshot.document.deletedAt && (
        <div className={styles.error} role="alert">
          동행이 이 문서를 휴지통으로 옮겼어요. 복원한 뒤 편집할 수 있습니다.
        </div>
      )}
      {error && (
        <div className={styles.syncError} role="alert">
          <span>{error}</span>
          <div>
            {snapshot.conflict ? (
              <>
                <button
                  disabled={disabled}
                  onClick={async () => {
                    if (
                      await confirm(
                        "동행의 최신 내용 위에 내 미저장 변경을 적용할까요? 같은 항목은 내 내용으로 바뀝니다.",
                        {
                          title: "내 변경 적용",
                          confirmLabel: "내 변경 적용",
                          intent: "default",
                        }
                      )
                    )
                      active.store.reapply();
                  }}
                >
                  내 변경 적용
                </button>
                <button
                  onClick={async () => {
                    if (
                      await confirm(
                        "임시 보관한 내 변경을 버리고 동행의 최신 내용을 사용할까요?",
                        { title: "내 변경 버리기", confirmLabel: "버리기" }
                      )
                    )
                      active.store.discard();
                  }}
                >
                  내 변경 버리기
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  active.store.retry();
                  void active.store.refresh().catch(() => {});
                }}
              >
                다시 시도
              </button>
            )}
            {snapshot.pending > 0 && !snapshot.conflict && (
              <button
                onClick={async () => {
                  if (
                    await confirm(
                      "미저장 변경을 버릴까요? 버린 변경은 복원할 수 없습니다.",
                      { title: "미저장 변경 버리기", confirmLabel: "버리기" }
                    )
                  )
                    active.store.discard();
                }}
              >
                내 변경 버리기
              </button>
            )}
          </div>
        </div>
      )}
      <div className={styles.editorContent}>
        {opened.map(({ id, store }) => (
          <div
            key={id}
            className={styles.documentSurface}
            hidden={id !== active.id}
          >
            <DocumentSurface
              store={store}
              disabled={disabled}
              onCell={id === active.id ? onCell : undefined}
            />
          </div>
        ))}
      </div>
    </dialog>,
    document.body
  );
}
function DocumentSurface({
  store,
  disabled,
  onCell,
}: {
  store: BrainStore;
  disabled: boolean;
  onCell?: (label: string) => void;
}) {
  const { document, unavailable } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return document.kind === "sheet" ? (
    <BrainSheet
      document={document}
      store={store}
      disabled={disabled || unavailable || !!document.deletedAt}
      onCell={onCell}
    />
  ) : (
    <BrainBoard
      document={document}
      store={store}
      disabled={disabled || unavailable || !!document.deletedAt}
    />
  );
}
