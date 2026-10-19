"use client";
import { useConfirm } from "./components/Confirmation";
import ChoiceField from "./components/ChoiceField";
import TimeField from "./components/TimeField";
import { memoText } from "./memo";
import { PlaceMedia } from "./components/Media";
import SortHandle from "./components/SortHandle";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  MapPin,
  StickyNote,
  SlidersHorizontal,
  LoaderCircle,
} from "lucide-react";
import type { Workspace, ItemRecord } from "./types";
import type { Leg, Connection } from "./route-graph";
import { distanceLabel, modes } from "./route-graph";
import { apiFetch as api, jsonRequest } from "./client-api";
import type { MapRoute } from "./server/maps";
import AddButton from "./components/AddButton";
import FeatureToolbar from "./components/FeatureToolbar";
import { dateLabel, text, Empty, Dialog } from "./components/ui";

let etaQueue: Promise<unknown> = Promise.resolve();
let lastEtaAt = 0;
const etaCache = new Map<string, number>();
function estimate(leg: Leg, mode: string, signal: AbortSignal) {
  const key = JSON.stringify([
    mode,
    leg.from.lat,
    leg.from.lng,
    leg.to.lat,
    leg.to.lng,
  ]);
  if (etaCache.has(key)) return Promise.resolve(etaCache.get(key)!);
  const task = etaQueue
    .catch(() => {})
    .then(async () => {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, 2200 - (Date.now() - lastEtaAt)))
      );
      if (signal.aborted) throw new Error("cancelled");
      if (etaCache.has(key)) return etaCache.get(key)!;
      lastEtaAt = Date.now();
      const r = await api<MapRoute>(
        "/api/maps/route",
        jsonRequest(
          {
            mode,
            points: [
              { lat: leg.from.lat, lng: leg.from.lng },
              { lat: leg.to.lat, lng: leg.to.lng },
            ],
          },
          { signal }
        )
      );
      const minutes = Math.max(1, Math.round(r.time / 60));
      if (etaCache.size >= 100) etaCache.delete(etaCache.keys().next().value!);
      etaCache.set(key, minutes);
      return minutes;
    });
  etaQueue = task;
  return task;
}
function LegEditor({
  connection,
  disabled,
  onSave,
}: {
  connection: Connection;
  disabled: boolean;
  onSave: (r: ItemRecord, data: Record<string, unknown>) => Promise<void>;
}) {
  const { leg, to: plan, from } = connection;
  const ref = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [draft, setDraft] = useState<string | null>(null),
    [automatic, setAutomatic] = useState<{
      key: string;
      minutes: number;
    } | null>(null),
    [finished, setFinished] = useState(""),
    [pendingMode, setPendingMode] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mode = pendingMode ?? text(plan.data.transportMode, "walk"),
    saved =
      plan.data.travelFromId === from.id &&
      plan.data.travelMinutes !== undefined &&
      plan.data.travelMinutes !== null
        ? String(plan.data.travelMinutes)
        : "";
  const estimateKey = JSON.stringify([
      mode,
      leg?.from.lat,
      leg?.from.lng,
      leg?.to.lat,
      leg?.to.lng,
    ]),
    canEstimate = !!leg && ["walk", "drive", "bicycle"].includes(mode);
  const auto = automatic?.key === estimateKey ? automatic.minutes : null;
  const minutes =
    draft ??
    ((pendingMode === null ? saved : "") ||
      (auto === null ? "" : String(auto)));
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canEstimate || !leg) return;
    const controller = new AbortController();
    estimate(leg, mode, controller.signal)
      .then((n) => {
        if (!controller.signal.aborted)
          setAutomatic({ key: estimateKey, minutes: n });
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setFinished(estimateKey);
      });
    return () => controller.abort();
    // A located connection and its mode own one estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, estimateKey, canEstimate]);
  async function save(data: Record<string, unknown>, remove = false) {
    setBusy(true);
    setError("");
    try {
      const next = { ...plan.data, ...data };
      if (remove) {
        delete next.travelFromId;
        delete next.travelMinutes;
      } else next.travelFromId = from.id;
      await onSave(plan, next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function changeMode(value: string) {
    if (value === mode || busy) return;
    setPendingMode(value);
    setDraft(null);
    setAutomatic(null);
    await save({ transportMode: value, travelMinutes: undefined });
    setPendingMode(null);
  }
  return (
    <div className="travel-leg" ref={ref}>
      <span className="leg-line" />
      {leg && <strong>{distanceLabel(leg.meters)}</strong>}
      <ChoiceField
        label={`${text(plan.data.title)}까지 이동 방식`}
        value={mode}
        options={modes.map((m) => ({ id: m.id, label: m.name }))}
        disabled={disabled || busy}
        onChange={(value) => void changeMode(value)}
      />
      <label className="manual-time">
        {draft === null && !saved && auto !== null && (
          <span className="approximate">약</span>
        )}
        <input
          aria-label={`${text(plan.data.title)}까지 이동 시간 (분)`}
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          step={1}
          placeholder="__"
          disabled={disabled || busy}
          value={minutes}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null || draft === saved) return;
            if (
              draft !== "" &&
              (!Number.isInteger(Number(draft)) ||
                Number(draft) < 0 ||
                Number(draft) > 100000)
            ) {
              setError("0~100000분으로 입력해북");
              return;
            }
            void save({
              travelMinutes: draft === "" ? undefined : Number(draft),
            });
          }}
        />
        <span>분</span>
        {visible &&
          canEstimate &&
          !saved &&
          draft === null &&
          auto === null &&
          finished !== estimateKey && (
            <LoaderCircle
              size={13}
              className="spinner"
              aria-label="이동 시간 계산 중"
            />
          )}
      </label>
      {!leg && (
        <button
          type="button"
          className="icon remove-connection"
          onPointerDown={(e) => e.preventDefault()}
          aria-label={`${text(plan.data.title)} 이동 삭제`}
          disabled={disabled || busy}
          onClick={() => void save({}, true)}
        >
          <Trash2 size={14} />
        </button>
      )}
      {busy && (
        <LoaderCircle size={13} className="spinner" aria-label="저장 중" />
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export default function ItineraryEditor({
  workspace,
  date,
  days,
  plans,
  places,
  connections,
  disabled,
  onSchedule,
  onEdit,
  onRemove,
  onAdd,
  onError,
  onSave,
  focused,
}: {
  focused?: string;
  workspace: Workspace;
  date: string;
  days: string[];
  plans: ItemRecord[];
  places: ItemRecord[];
  connections: Connection[];
  disabled: boolean;
  onSchedule: (p: Record<string, unknown>) => Promise<Workspace | undefined>;
  onEdit: (r: ItemRecord) => void;
  onRemove: (r: ItemRecord) => void;
  onAdd: () => void;
  onError: (s: string) => void;
  onSave: (r: ItemRecord, data: Record<string, unknown>) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string[]>([]),
    [destination, setDestination] = useState<{
      operation: string;
      ids: string[];
      title: string;
      revision: number;
    } | null>(null),
    [target, setTarget] = useState(""),
    [actionError, setActionError] = useState(""),
    [acting, setActing] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const selection = selected.filter((id) => plans.some((p) => p.id === id));
  async function command(
    operation: string,
    ids = selection,
    extra: Record<string, unknown> = {}
  ) {
    try {
      const next = await onSchedule({
        revision: workspace.revision,
        operation,
        ids,
        sourceDate: date,
        targetDate: date,
        ...extra,
      });
      if (next && operation !== "reorder") setSelected([]);
      return next;
    } catch (e) {
      setActionError((e as Error).message);
      onError((e as Error).message);
    }
  }
  async function reorder(ids: string[]) {
    await command("reorder", ids, { targetDate: date });
  }
  function chooseDestination(operation: string, ids: string[], title: string) {
    setTarget("");
    setActionError("");
    setDestination({ operation, ids, title, revision: workspace.revision });
  }
  let number = 0;
  return (
    <section className="itinerary">
      <FeatureToolbar
        className="section-heading"
        action={
          <>
            {!advanced && (
              <AddButton
                label="일정 추가"
                disabled={disabled}
                onClick={onAdd}
              />
            )}
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => {
                setAdvanced(!advanced);
                setSelected([]);
              }}
              aria-expanded={advanced}
            >
              <SlidersHorizontal size={18} />
              {advanced ? "완료" : "편집"}
            </button>
          </>
        }
      >
        <div>
          <p className="eyebrow">DAY {days.indexOf(date) + 1}</p>
          <h2>{dateLabel(date)}</h2>
        </div>
      </FeatureToolbar>
      {advanced && (
        <div className="schedule-tools">
          <label className="select-all">
            <input
              type="checkbox"
              checked={plans.length > 0 && selection.length === plans.length}
              disabled={disabled}
              onChange={(e) =>
                setSelected(e.target.checked ? plans.map((p) => p.id) : [])
              }
            />
            <small>전체</small>
          </label>
          <span className="selection-count" aria-live="polite">
            {selection.length}개 선택됨
          </span>
          <div className="bulk-actions">
            <button
              disabled={disabled || !selection.length}
              onClick={() =>
                chooseDestination("move", selection, "선택한 일정 이동")
              }
            >
              이동
            </button>
            <button
              disabled={disabled || !selection.length}
              onClick={() =>
                chooseDestination("copy", selection, "선택한 일정 복사")
              }
            >
              복사
            </button>
            <button
              disabled={disabled || days.length < 2}
              onClick={() =>
                chooseDestination("swap-days", [], "날짜 일정 맞바꾸기")
              }
            >
              날짜 교환
            </button>
            <button
              className="danger-text"
              disabled={disabled || !selection.length}
              onClick={async () => {
                if (
                  await confirm(
                    `선택한 ${selection.length}개 항목을 삭제할까요?`
                  )
                )
                  void command("delete");
              }}
            >
              삭제
            </button>
          </div>
        </div>
      )}
      <div className={`timeline ${advanced ? "editing-timeline" : ""}`}>
        {plans.map((r) => {
          const memo = r.data.entryType === "memo",
            place = places.find((p) => p.id === r.data.placeId),
            connection = connections.find((c) => c.to.id === r.id);
          if (!memo) number++;
          if (advanced)
            return (
              <article
                key={r.id}
                className="edit-plan-row"
                id={`plan-${r.id}`}
                tabIndex={-1}
                data-focused={focused === r.id}
                data-selected={selection.includes(r.id)}
                data-sort-id={r.id}
                data-sort-group="itinerary"
              >
                <label className="compact-check">
                  <input
                    type="checkbox"
                    aria-label={`${text(r.data.title)} 일정 선택`}
                    checked={selection.includes(r.id)}
                    disabled={disabled}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, r.id]
                          : selected.filter((id) => id !== r.id)
                      )
                    }
                  />
                </label>
                <div className="compact-plan">
                  <SortHandle
                    id={r.id}
                    group="itinerary"
                    ids={plans.map((p) => p.id)}
                    label={text(r.data.title)}
                    disabled={disabled}
                    onReorder={(ids) => void reorder(ids)}
                  />
                  <div className="compact-plan-content">
                    <span>{memo ? memoText(r.data) : text(r.data.title)}</span>
                    <small>
                      {memo
                        ? "메모"
                        : [
                            text(r.data.time),
                            place ? text(place.data.name) : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </small>
                  </div>
                </div>
                <button
                  className="icon edit-delete"
                  aria-label={`${text(r.data.title)} 삭제`}
                  disabled={disabled}
                  onClick={() => onRemove(r)}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            );
          return (
            <div key={r.id}>
              {connection &&
                (connection.leg ||
                r.data.travelFromId === connection.from.id ? (
                  <LegEditor
                    key={`${r.id}-${r.version}`}
                    connection={connection}
                    disabled={disabled}
                    onSave={onSave}
                  />
                ) : (
                  <button
                    type="button"
                    className="add-connection text-button"
                    disabled={disabled}
                    onClick={() => {
                      void onSave(r, {
                        ...r.data,
                        travelFromId: connection.from.id,
                        transportMode: "walk",
                      }).catch((e) => onError((e as Error).message));
                    }}
                  >
                    <Plus size={13} />
                    이동 추가
                  </button>
                ))}
              <article
                id={`plan-${r.id}`}
                className={`plan-row ${memo ? "memo-row" : ""}`}
                tabIndex={-1}
                data-focused={focused === r.id}
                data-sort-id={r.id}
                data-sort-group="itinerary"
              >
                <div className="plan-number">
                  {memo ? <StickyNote size={18} /> : number}
                </div>
                <div className="plan-card">
                  <div className="plan-heading">
                    {memo ? (
                      <p className="preserve memo-body">{memoText(r.data)}</p>
                    ) : (
                      <h3>{text(r.data.title)}</h3>
                    )}
                    <div className="row-actions">
                      {!memo && !text(r.data.time) && (
                        <TimeField
                          value=""
                          disabled={disabled}
                          onChange={(value) => {
                            void onSave(r, { ...r.data, time: value }).catch(
                              (e) => onError((e as Error).message)
                            );
                          }}
                        />
                      )}
                      <button
                        className="icon"
                        disabled={disabled}
                        aria-label={`${text(r.data.title)} 수정`}
                        onClick={() => onEdit(r)}
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="icon"
                        disabled={disabled}
                        aria-label={`${text(r.data.title)} 삭제`}
                        onClick={() => onRemove(r)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  {!memo && (
                    <div className="plan-content">
                      <div className="plan-details">
                        <div className="plan-meta">
                          {text(r.data.time) && (
                            <TimeField
                              value={text(r.data.time)}
                              disabled={disabled}
                              onChange={(value) => {
                                void onSave(r, {
                                  ...r.data,
                                  time: value,
                                }).catch((e) => onError((e as Error).message));
                              }}
                            />
                          )}
                          {place ? (
                            <a
                              className="plan-place"
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                `${place.data.lat},${place.data.lng}`
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MapPin size={13} />
                              <span>{text(place.data.name)}</span>
                            </a>
                          ) : (
                            <small>장소 미정</small>
                          )}
                          {Number(r.data.duration) > 0 && (
                            <small>{String(r.data.duration)}분</small>
                          )}
                        </div>
                        {Boolean(r.data.note) && (
                          <p className="preserve plan-note">
                            {text(r.data.note)}
                          </p>
                        )}
                      </div>
                      {place && <PlaceMedia place={place.data} compact />}
                    </div>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>
      {!plans.length && <Empty title="일정이 없어북"></Empty>}
      {destination && (
        <Dialog
          title={destination.title}
          onClose={() => {
            if (!acting) setDestination(null);
          }}
        >
          <div className="stack">
            <p className="muted">
              {destination.operation === "swap-days"
                ? "맞바꿀 날짜를 선택하세요. 두 날짜의 일정 전체가 서로 이동합니다."
                : `${destination.ids.length}개 항목을 어느 날에 ${
                    destination.operation === "move"
                      ? "옮길까북?"
                      : "복사할까북?"
                  }`}
            </p>
            <div className="destination-days">
              {days.map((d, i) => (
                <button
                  key={d}
                  className={target === d ? "active" : ""}
                  disabled={
                    disabled ||
                    acting ||
                    (d === date && destination.operation !== "copy")
                  }
                  aria-pressed={target === d}
                  onClick={() => setTarget(d)}
                >
                  <strong>DAY {i + 1}</strong>
                  <span>{dateLabel(d)}</span>
                  <small>
                    {
                      workspace.records.filter(
                        (r) => r.kind === "plan" && r.data.date === d
                      ).length
                    }
                    개 일정{d === date ? " · 현재 날짜" : ""}
                  </small>
                </button>
              ))}
            </div>
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="primary"
              disabled={disabled || acting || !target}
              onClick={async () => {
                setActing(true);
                setActionError("");
                try {
                  const next = await command(
                    destination.operation,
                    destination.ids,
                    { targetDate: target, revision: destination.revision }
                  );
                  if (next) setDestination(null);
                } finally {
                  setActing(false);
                }
              }}
            >
              {acting
                ? "서버에 저장 중…"
                : target
                ? `DAY ${days.indexOf(target) + 1}${
                    destination.operation === "swap-days"
                      ? "과 맞바꾸기"
                      : destination.operation === "move"
                      ? "로 이동"
                      : "에 복사"
                  }`
                : "날짜를 선택하세요"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
