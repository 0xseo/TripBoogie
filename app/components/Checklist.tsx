"use client";
import Form from "./Form";
import { useState } from "react";
import { Pencil, Trash2, Check } from "lucide-react";
import type { Workspace, ItemRecord } from "../types";
import { Dialog, Field, Empty, text } from "./ui";
import ChoiceField from "./ChoiceField";
import AddButton from "./AddButton";
import FeatureToolbar from "./FeatureToolbar";
import ListControls from "./ListControls";
import { matchesListQuery, compareListRecords } from "../list-records";
import {checklistEntries, compareChecklist, mergeChecklistOrder} from "../checklist";
import SortHandle from "./SortHandle";
import styles from "./Checklist.module.css";
export default function Checklist({
  workspace,
  userId,
  readOnly,
  onSave,
  onDelete,
  onToggle,
  onReorder,
}: {
  workspace: Workspace;
  userId: string;
  readOnly: boolean;
  onSave: (d: Record<string, unknown>, r?: ItemRecord) => Promise<void>;
  onDelete: (r: ItemRecord) => void;
  onToggle: (r: ItemRecord, done: boolean) => Promise<void>;
  onReorder: (category: string, ids: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState(""), [order, setOrder] = useState("manual");
  const [editing, setEditing] = useState<ItemRecord | "new" | null>(null),
    [categoryId, setCategoryId] = useState<string | null>(null),
    [hideCompleted, setHideCompleted] = useState(false),
    [orderingCategory, setOrderingCategory] = useState<string | null>(null),
    [error, setError] = useState("");
  const rows = workspace.records.filter((r) => r.kind === "checklist"),
    categories = workspace.trip.settings.checklistCategories;
  const groupIds = Array.from(
    new Set([
      ...categories.map((c) => c.id),
      ...rows.map((r) => text(r.data.category)),
    ])
  );
  const activeCategory =
    categoryId !== null && groupIds.includes(categoryId) ? categoryId : null;
  const shownGroups = groupIds
    .filter((id) => activeCategory === null || activeCategory === id)
    .map((id) => ({
      id,
      rows: rows.filter((r) => text(r.data.category) === id).sort(compareChecklist),
    }))
    .filter((group) => group.rows.some(r => matchesListQuery(query, [r.data.title, r.createdName, categories.find(c => c.id === group.id)?.label,
      workspace.members.find(m => m.id === r.createdBy)?.name])));
  const matches = (r: ItemRecord) => matchesListQuery(query, [r.data.title, r.createdName, categories.find(c => c.id === r.data.category)?.label,
    workspace.members.find(m => m.id === r.createdBy)?.name]);
  const matchingCount = shownGroups.reduce((count, group) => count + checklistEntries(group.rows, userId, hideCompleted).filter(e => matches(e.record)).length, 0);
  function selectCategory(id: string | null) {
    setCategoryId(id);
    setEditing(null);
    setOrderingCategory(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return (
    <section className="feature">
      <FeatureToolbar tabs className={styles.toolbar} action={
        <AddButton label="할 일 추가" disabled={readOnly} onClick={() => setEditing("new")} />
      }>
      <nav
        className="booking-category-tabs checklist-category-tabs"
        aria-label="체크리스트 분류"
      >
        <button
          type="button"
          aria-current={activeCategory === null ? "page" : undefined}
          onClick={() => selectCategory(null)}
        >
          전체
        </button>
        {groupIds.map((id) => (
          <button
            type="button"
            key={id}
            aria-current={activeCategory === id ? "page" : undefined}
            onClick={() => selectCategory(id)}
          >
            {categories.find((c) => c.id === id)?.label || id || "미분류"}
          </button>
        ))}
      </nav>
      </FeatureToolbar>
      <ListControls label="체크리스트" query={query} onQuery={setQuery} order={order} onOrder={value=>{setOrder(value);setOrderingCategory(null);}} count={matchingCount} options={[
        {id:"manual",label:"지정한 순서"},{id:"title",label:"이름순"},{id:"updated-desc",label:"최근 수정순"},
      ]} footer={
        <label className={styles.hideCompleted}><input type="checkbox" checked={hideCompleted} onChange={e=>setHideCompleted(e.target.checked)}/>완료된 항목 보지 않기</label>
      }/>
      {error && <p className="error">{error}</p>}
      <div className={styles.grid}>
        {shownGroups.map(({ id, rows: group }) => {
          const allEntries=checklistEntries(group,userId), entries=checklistEntries(group,userId,hideCompleted).filter(entry=>matches(entry.record)).sort((a,b)=>Number(a.done)-Number(b.done)||(order==="manual"?compareChecklist(a.record,b.record):compareListRecords(a.record,b.record,order)));
          const completedCount=allEntries.filter(entry=>entry.done).length, ordering=orderingCategory===id;
          return (
            <section className={styles.group} key={id}>
              <header className={styles.groupHeader}>
                <h3>{categories.find((c) => c.id === id)?.label || id || "미분류"}</h3>
                {!readOnly && <button type="button" className={styles.orderButton} aria-pressed={ordering} onClick={()=>{setOrder("manual");setOrderingCategory(ordering?null:id);}}>{ordering?"완료":"순서 조정"}</button>}
                <span className={styles.progress} data-complete={completedCount===group.length} aria-label={`완료 ${completedCount}개, 전체 ${group.length}개`}>{completedCount}/{group.length}</span>
              </header>
              {entries.map(({record:r,done,checks}) => {
                const all = r.data.scope === "all",
                  completedPeople = workspace.members.filter((m) => checks[m.id]),
                  creator =
                    r.createdName ||
                    workspace.members.find((m) => m.id === r.createdBy)?.name ||
                    "이전 작성자";
                return (
                  <article className={styles.row} data-done={done} data-ordering={ordering} key={r.id} data-sort-id={r.id} data-sort-group={`checklist-${id}-${done}`}>
                    {ordering ? <SortHandle id={r.id} group={`checklist-${id}-${done}`} ids={entries.filter(entry=>entry.done===done).map(entry=>entry.record.id)} label={text(r.data.title)} onReorder={ids=>{void onReorder(id,mergeChecklistOrder(group,ids)).catch(e=>setError((e as Error).message));}}/> : <button
                      className={styles.toggle}
                      type="button"
                      aria-label={`${text(r.data.title)} ${
                        done ? "완료 해제" : "완료"
                      }`}
                      aria-pressed={done}
                      disabled={readOnly && workspace.trip.role !== "viewer"}
                      onClick={async () => {
                        try {
                          await onToggle(r, !done);
                          setError("");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <span className={styles.indicator}>{done?<Check size={14}/>:null}</span>
                    </button>}
                    <div className={styles.body}>
                      <strong>{text(r.data.title)}</strong>
                      <small>
                        {creator} 추가 ·{" "}
                        {all
                          ? `각자 체크 ${completedPeople.length}/${workspace.members.length}명`
                          : "함께 한 번 체크"}
                      </small>
                      {all && (
                        <div className={styles.memberProgress}>
                          {workspace.members.map((m) => (
                            <span
                              key={m.id}
                              className={checks[m.id] ? styles.complete : ""}
                              title={`${m.name} ${
                                checks[m.id] ? "완료" : "미완료"
                              }`}
                            >
                              {checks[m.id] ? "✓ " : ""}
                              {m.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={styles.actions}>
                    <button
                      className={styles.action}
                      type="button"
                      aria-label="체크 항목 수정"
                      disabled={readOnly}
                      onClick={() => setEditing(r)}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className={styles.action}
                      type="button"
                      aria-label="체크 항목 삭제"
                      disabled={readOnly}
                      onClick={() => onDelete(r)}
                    >
                      <Trash2 size={17} />
                    </button></div>
                  </article>
                );
              })}
              {!entries.length && <p className={styles.allDone}>{query.trim()?"검색 결과가 없어요.":"모든 할 일을 완료했어요."}</p>}
            </section>
          );
        })}
      </div>

      {!shownGroups.length && <Empty title={query.trim()?"검색 결과가 없어북":"아직 할 일이 없어북"} />}
      {editing && (
        <CheckForm
          initialCategory={activeCategory ?? undefined}
          key={editing === "new" ? "new" : editing.id}
          record={editing === "new" ? undefined : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={(d) => onSave(d, editing === "new" ? undefined : editing)}
        />
      )}
    </section>
  );
}
function CheckForm({
  initialCategory,
  record,
  categories,
  onSave,
  onClose,
}: {
  record?: ItemRecord;
  initialCategory?: string;
  categories: { id: string; label: string }[];
  onSave: (d: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(text(record?.data.title)),
    [category, setCategory] = useState(
      text(record?.data.category, initialCategory ?? categories[0]?.id ?? "")
    ),
    [scope, setScope] = useState(text(record?.data.scope, "once")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog mobilePage title={record ? "할 일 수정" : "할 일 추가"} onClose={onClose}>
      <Form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              title,
              category,
              scope,
              done: record?.data.done === true,
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="무엇을 준비할까요?">
          <input
            required
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 여권 챙기기"
          />
        </Field>
        <Field label="분류">
          <ChoiceField
            label="분류"
            value={category}
            options={[{ id: "", label: "미분류" }, ...categories]}
            onChange={setCategory}
          />
        </Field>
        <Field label="완료 방식">
          <ChoiceField label="완료 방식" value={scope} onChange={setScope} options={[
            {id:"once",label:"함께 한 번 · 한 명이 체크하면 완료"},
            {id:"all",label:"각자 체크 · 모두 따로 완료"},
          ]}/>
        </Field>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "저장 중…" : "저장"}
        </button>
      </Form>
    </Dialog>
  );
}
