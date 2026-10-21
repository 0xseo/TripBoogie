"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FileImage, FolderInput, Pencil, Trash2 } from "lucide-react";
import type { Workspace, OverviewRow, OverviewChange } from "../types";
import { shortDate } from "../calendar";
import {
  emptyOverview,
  importOverview,
  overviewCandidatesByDate,
  overviewStorageKey,
  overviewTextLimit,
  parseOverview,
  overviewFromRows,
  overviewChanges,
  sameOverviewSources,
  type OverviewCandidate,
  type OverviewDraft,
  type OverviewSeparator,
} from "../itinerary-overview";
import ExportDialog from "./OverviewExportDialog";
import ChoiceField from "./ChoiceField";
import { useConfirm } from "./Confirmation";
import Dialog from "./Dialog";
import styles from "./TripOverview.module.css";

type Props = {
  workspace: Workspace;
  days: string[];
  accountId: string;
  disabled?: boolean;
  onSave: (rows: OverviewChange[]) => Promise<void>;
  preview?: boolean;
};
type ImportRequest = {
  dates: string[];
  draft: OverviewDraft;
  rows: OverviewRow[];
};
const emptyRows: OverviewRow[] = [];
const subscribe = () => () => {};
const failureText = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";

export default function TripOverview(props: Props) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  return mounted ? (
    <OverviewEditor
      key={overviewStorageKey(props.accountId, props.workspace.trip.id)}
      {...props}
    />
  ) : (
    <p className={styles.loading}>한눈에 보기를 준비하고 있어요…</p>
  );
}

function readLegacy(key: string) {
  try {
    return parseOverview(localStorage.getItem(key));
  } catch {
    return emptyOverview();
  }
}

function OverviewEditor({
  workspace,
  days,
  accountId,
  disabled = false,
  onSave,
}: Props) {
  const key = overviewStorageKey(accountId, workspace.trip.id);
  const [legacy, setLegacy] = useState(() => readLegacy(key));
  const [editing, setEditing] = useState<{
    date: string;
    initial?: OverviewRow;
  } | null>(null);
  const [importRequest, setImportRequest] = useState<ImportRequest | null>(
      null
    ),
    [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const confirm = useConfirm();
  const rows = workspace.overview ?? emptyRows;
  const rowByDate = useMemo(
    () => new Map(rows.map((row) => [row.date, row])),
    [rows]
  );
  const dates = useMemo(
    () => [...new Set([...days, ...rowByDate.keys()])].sort(),
    [days, rowByDate]
  );
  const draft = useMemo(() => overviewFromRows(rows), [rows]);
  const filled = useMemo(
    () => dates.filter((date) => draft.days[date]?.text.trim()).length,
    [dates, draft]
  );
  const ready = workspace.overview !== undefined;
  const locked = disabled || saving || !ready;
  const hasLegacy = Object.values(legacy.days).some((day) => day.text.trim());

  async function saveRows(changes: OverviewChange[]) {
    if (!changes.length) return;
    setSaving(true);
    setError("");
    try {
      await onSave(changes);
    } finally {
      setSaving(false);
    }
  }
  async function emptyTable() {
    if (
      !(await confirm(
        "동행과 공유하는 요약표 내용을 모두 비울까요? 원본 일정·예약은 그대로 유지됩니다.",
        { title: "요약표 비우기", confirmLabel: "비우기" }
      ))
    )
      return;
    try {
      await saveRows(
        rows
          .filter((row) => row.text || row.sourceIds.length)
          .map((row) => ({
            date: row.date,
            text: "",
            sourceIds: [],
            version: row.version,
          }))
      );
    } catch (cause) {
      setError(failureText(cause));
    }
  }
  async function uploadLegacy() {
    if (
      Object.entries(legacy.days).some(
        ([date, day]) => day.text.trim() && !dates.includes(date)
      )
    ) {
      setError(
        "이 기기의 표에 현재 여행 기간 밖의 날짜가 있어요. 여행 기간을 확인해 주세요. 기기에 저장된 표는 유지했어요."
      );
      return;
    }
    if (
      !(await confirm(
        "이 브라우저에 저장했던 표를 동행과 공유할까요? 이미 공유 중인 날짜에는 기존 내용 아래에 추가됩니다.",
        {
          title: "이 기기의 표 올리기",
          confirmLabel: "공유하기",
          intent: "default",
        }
      ))
    )
      return;
    const next = { schema: 1 as const, days: { ...draft.days } };
    for (const [date, day] of Object.entries(legacy.days)) {
      if (!dates.includes(date) || !day.text.trim()) continue;
      const saved = draft.days[date];
      next.days[date] = {
        text:
          saved?.text === day.text
            ? day.text
            : [saved?.text, day.text].filter(Boolean).join("\n"),
        sourceIds: [
          ...new Set([...(saved?.sourceIds ?? []), ...day.sourceIds]),
        ],
      };
    }
    try {
      await saveRows(overviewChanges(draft, next, rows));
      setLegacy(emptyOverview());
      try {
        localStorage.removeItem(key);
      } catch {}
    } catch (cause) {
      setError(failureText(cause));
    }
  }
  return (
    <section className={styles.overview} aria-label="일정 한눈에 보기">
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <button
            type="button"
            className="secondary"
            disabled={locked}
            onClick={() => setImportRequest({ dates, draft, rows })}
          >
            <FolderInput size={17} />
            기존 일정 불러오기
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ready || !dates.length}
            onClick={() => setExporting(true)}
          >
            <FileImage size={17} />
            이미지 저장
          </button>
        </div>
        <button
          type="button"
          className={styles.clear}
          disabled={locked || !filled}
          onClick={() => void emptyTable()}
        >
          <Trash2 size={15} />
          <span>표 비우기</span>
        </button>
      </div>
      <p className={styles.help}>표를 고쳐도 원본 일정·예약은 바뀌지 않아북</p>
      {hasLegacy && (
        <div className={styles.legacy}>
          <span>이 브라우저에 저장했던 요약표가 있어요.</span>
          <button
            type="button"
            className="secondary"
            disabled={locked}
            onClick={() => void uploadLegacy()}
          >
            이 기기의 표 올리기
          </button>
        </div>
      )}
      {!ready && (
        <p className="error" role="alert">
          요약표 저장소를 확인하지 못했어요. 새로고침해 주세요.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.caption}>
            {workspace.trip.title} · {dates.length}일 중 {filled}일 작성
          </caption>
          <thead>
            <tr>
              <th scope="col">날짜</th>
              <th scope="col">
                일정
                <span>{disabled ? "열람 권한" : "날짜 칸을 눌러 편집"}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date, index) => (
              <tr key={date}>
                <th scope="row">
                  <small>DAY {index + 1}</small>
                  <strong>{shortDate(date)}</strong>
                </th>
                <td>
                  <button
                    type="button"
                    className={styles.cellPreview}
                    disabled={locked}
                    aria-label={`${shortDate(date)} 요약 일정 편집`}
                    onClick={() =>
                      setEditing({ date, initial: rowByDate.get(date) })
                    }
                  >
                    <span
                      className={
                        draft.days[date]?.text ? undefined : styles.placeholder
                      }
                    >
                      {draft.days[date]?.text || "일정 입력"}
                    </span>
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <CellEditor
          key={editing.date}
          workspace={workspace}
          date={editing.date}
          initial={editing.initial}
          latest={rowByDate.get(editing.date)}
          disabled={disabled}
          onSave={async (row) => {
            await saveRows([row]);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {importRequest && (
        <ImportDialog
          workspace={workspace}
          days={importRequest.dates}
          draft={importRequest.draft}
          onClose={() => setImportRequest(null)}
          onImport={async (items, mode, separator) => {
            const next = importOverview(
              importRequest.draft,
              items,
              mode,
              separator
            );
            await saveRows(
              overviewChanges(importRequest.draft, next, importRequest.rows)
            );
            setImportRequest(null);
          }}
        />
      )}
      {exporting && (
        <ExportDialog
          title={workspace.trip.title}
          rows={dates.map((date) => ({
            date,
            text: draft.days[date]?.text ?? "",
          }))}
          onClose={() => setExporting(false)}
        />
      )}
    </section>
  );
}

function CellEditor({
  workspace,
  date,
  initial,
  latest,
  disabled,
  onSave,
  onClose,
}: {
  workspace: Workspace;
  date: string;
  initial?: OverviewRow;
  latest?: OverviewRow;
  disabled: boolean;
  onSave: (row: OverviewChange) => Promise<void>;
  onClose: () => void;
}) {
  const [base, setBase] = useState({
    text: initial?.text ?? "",
    sourceIds: initial?.sourceIds ?? [],
    version: initial?.version ?? 0,
  });
  const [value, setValue] = useState(base.text),
    [sourceIds, setSourceIds] = useState(base.sourceIds);
  const [saving, setSaving] = useState(false),
    [importing, setImporting] = useState(false),
    [error, setError] = useState("");
  const confirm = useConfirm();
  const input = useRef<HTMLTextAreaElement | null>(null);
  const focus = useCallback((node: HTMLTextAreaElement | null) => {
    input.current = node;
    if (node)
      requestAnimationFrame(() => {
        if (node.isConnected) {
          node.focus();
          node.setSelectionRange(node.value.length, node.value.length);
        }
      });
  }, []);
  const dirty =
    value !== base.text || !sameOverviewSources(sourceIds, base.sourceIds);
  const conflict =
    !saving &&
    (latest?.version ?? 0) !== base.version &&
    ((latest?.text ?? "") !== value ||
      !sameOverviewSources(latest?.sourceIds ?? [], sourceIds));
  async function close() {
    if (saving) return;
    if (
      dirty &&
      !(await confirm("입력한 내용을 저장하지 않고 닫을까요?", {
        title: "편집 중인 내용",
        confirmLabel: "저장하지 않고 닫기",
      }))
    )
      return;
    onClose();
  }
  function merge() {
    const remote = {
      text: latest?.text ?? "",
      sourceIds: latest?.sourceIds ?? [],
      version: latest?.version ?? 0,
    };
    setValue(
      dirty && remote.text !== value
        ? [remote.text, value].filter(Boolean).join("\n")
        : remote.text
    );
    setSourceIds([...new Set([...remote.sourceIds, ...sourceIds])]);
    setBase(remote);
    setError("");
  }
  async function save() {
    if (disabled || saving || conflict) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ date, text: value, sourceIds, version: base.version });
    } catch (cause) {
      setError(failureText(cause));
    } finally {
      setSaving(false);
    }
  }
  const localDraft: OverviewDraft = {
    schema: 1,
    days: { [date]: { text: value, sourceIds } },
  };
  return (
    <Dialog
      title={`${shortDate(date)} 요약 편집`}
      mobilePage
      onClose={() => void close()}
    >
      <form
        className={`${styles.cellEditorForm} overview-cell-editor`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
      >
        <div className={styles.editorToolbar}>
          <button
            type="button"
            className="secondary"
            disabled={disabled || saving}
            onClick={() => setImporting(true)}
          >
            <FolderInput size={15} />
            일정 불러오기
          </button>
        </div>
        {conflict && (
          <div className={styles.conflict} role="alert">
            <p>동행이 이 날짜를 수정했어요. 내 입력은 유지했어요.</p>
            <details>
              <summary>최신 내용 확인</summary>
              <pre>{latest?.text || "(비어 있음)"}</pre>
            </details>
            <button type="button" className="secondary" onClick={merge}>
              최신 내용 합쳐서 편집
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <textarea
          ref={focus}
          className={styles.editorInput}
          aria-label={`${shortDate(date)} 요약 일정`}
          value={value}
          maxLength={overviewTextLimit}
          disabled={disabled || saving}
          onChange={(event) => setValue(event.target.value)}
          placeholder="일정을 직접 적거나 불러와 주세요."
        />
        <footer className={styles.editorFooter}>
          <small>
            {value.length.toLocaleString("ko-KR")} /{" "}
            {overviewTextLimit.toLocaleString("ko-KR")}
          </small>
          <div>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => void close()}
            >
              취소
            </button>
            <button
              type="submit"
              className="primary"
              disabled={
                disabled ||
                saving ||
                conflict ||
                value.length > overviewTextLimit
              }
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </footer>
      </form>
      {importing && (
        <ImportDialog
          workspace={workspace}
          days={[date]}
          draft={localDraft}
          onClose={() => setImporting(false)}
          onImport={(items, mode, separator) => {
            const next = importOverview(localDraft, items, mode, separator)
              .days[date];
            if (next) {
              setValue(next.text);
              setSourceIds(next.sourceIds);
            }
            setImporting(false);
            requestAnimationFrame(() => input.current?.focus());
          }}
        />
      )}
    </Dialog>
  );
}

function ImportDialog({
  workspace,
  days,
  draft,
  onClose,
  onImport,
}: {
  workspace: Workspace;
  days: string[];
  draft: OverviewDraft;
  onClose: () => void;
  onImport: (
    items: OverviewCandidate[],
    mode: "append" | "replace",
    separator: OverviewSeparator
  ) => void | Promise<void>;
}) {
  const [times, setTimes] = useState(true),
    [hotels, setHotels] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [separator, setSeparator] = useState<OverviewSeparator>("\n");
  const candidatesByDate = useMemo(
    () => overviewCandidatesByDate({ records: workspace.records }, days, times),
    [workspace.records, days, times]
  );
  const candidates = useMemo(
    () => [...candidatesByDate.values()].flat(),
    [candidatesByDate]
  );
  const [selected, setSelected] = useState(
    () =>
      new Set(
        candidates
          .filter(
            (item) =>
              !item.hotel &&
              !item.sourceIds.some((id) =>
                draft.days[item.date]?.sourceIds.includes(id)
              )
          )
          .map((item) => item.id)
      )
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const visibleByDate = useMemo(
    () =>
      new Map(
        [...candidatesByDate].map(([date, items]) => [
          date,
          items.filter((item) => hotels || !item.hotel),
        ])
      ),
    [candidatesByDate, hotels]
  );
  const visible = [...visibleByDate.values()].flat();
  const chosen = visible.filter((item) => selected.has(item.id));
  async function apply() {
    if (
      mode === "replace" &&
      chosen.some((item) => draft.days[item.date]?.text.trim()) &&
      !(await confirm(
        "선택한 날짜의 표 내용을 선택한 일정으로 바꿀까요? 직접 적은 내용도 교체됩니다.",
        { title: "표 내용 바꾸기", confirmLabel: "바꾸기", intent: "default" }
      ))
    )
      return;
    setBusy(true);
    try {
      await onImport(chosen, mode, separator);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        days.length === 1
          ? `${shortDate(days[0])} 일정 불러오기`
          : "기존 일정 불러오기"
      }
      wide
      onClose={onClose}
    >
      <div className={styles.importContent}>
        <div className={styles.importOptions}>
          <label>
            <input
              type="checkbox"
              checked={times}
              onChange={(event) => setTimes(event.target.checked)}
            />
            시간 포함
          </label>
          <label>
            <input
              type="checkbox"
              checked={hotels}
              onChange={(event) => {
                setHotels(event.target.checked);
                if (event.target.checked)
                  setSelected(
                    (current) =>
                      new Set([
                        ...current,
                        ...candidates
                          .filter((item) => item.hotel)
                          .map((item) => item.id),
                      ])
                  );
              }}
            />
            숙소 포함
          </label>
          <div className={styles.optionField}>
            <span>연결 방식</span>
            <ChoiceField label="연결 방식" value={separator}
              options={[{id:"\n",label:"일정마다 줄바꿈"},{id:" · ",label:"구분점으로 연결"}]}
              disabled={busy} onChange={value => setSeparator(value as typeof separator)} />
          </div>
          <div className={styles.optionField}>
            <span>넣을 위치</span>
            <ChoiceField label="넣을 위치" value={mode}
              options={[{id:"append",label:"기존 내용 아래에 추가"},{id:"replace",label:"해당 날짜 내용 바꾸기"}]}
              disabled={busy} onChange={value => {
                const next = value as typeof mode;
                setMode(next);
                if (next === "replace")
                  setSelected(new Set(visible.map((item) => item.id)));
              }} />
          </div>
        </div>
        <div className={styles.selectionBar}>
          <span>{chosen.length}개 선택</span>
          <div>
            <button
              type="button"
              onClick={() =>
                setSelected(new Set(visible.map((item) => item.id)))
              }
            >
              전체 선택
            </button>
            <button type="button" onClick={() => setSelected(new Set())}>
              선택 해제
            </button>
          </div>
        </div>
        <div className={styles.candidates}>
          {!visible.length && (
            <p className={styles.empty}>
              불러올 일정이 없어요. 표에 직접 입력하거나 숙소 포함을 선택해
              주세요.
            </p>
          )}
          {days.map((date) => {
            const items = visibleByDate.get(date) ?? [];
            return (
              !!items.length && (
                <fieldset key={date}>
                  <legend>{shortDate(date)}</legend>
                  {items.map((item) => (
                    <label className={styles.candidate} key={item.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      <span>
                        {item.text}
                        {item.sourceIds.some((id) =>
                          draft.days[date]?.sourceIds.includes(id)
                        ) && <small>이전에 불러온 항목</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )
            );
          })}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className="secondary" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !chosen.length}
            onClick={() => void apply()}
          >
            <FolderInput size={17} />
            {busy ? "저장 중…" : `${chosen.length}개 불러오기`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
