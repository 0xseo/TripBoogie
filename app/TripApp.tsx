"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Cloud,
  Compass,
  Copy,
  CreditCard,
  LayoutGrid,
  Link2,
  ListChecks,
  LoaderCircle,
  LogIn,
  Map,
  MapPin,
  Pencil,
  Plane,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  WifiOff,
  X,
} from "lucide-react";
import type { Trip, Workspace, ItemRecord, Member, ItemKind } from "./types";
import { apiFetch as api, getSupabaseClient, signOut } from "./client-api";
import Image from "next/image";
import AuthPanel from "./AuthPanel";
import MapPanel from "./MapPanel";
import { itemData, tripData } from "./server/validation";

type Tab = "plan" | "places" | "expenses" | "checklist" | "members";
type Mode = "local" | "shared" | "demo";
type Modal = {
  type: "trip" | "plan" | "place" | "expense" | "checklist" | "settings" | "invite";
  record?: ItemRecord;
} | null;
type User = { id: string; email: string; name: string };
type StoredTrip = { workspace: Workspace; mode: "local" | "demo" };
type Invite = { id: string; role: string; expiresAt: string; url?: string };
const STORAGE_KEY = "tripboogie.local.v1";
const TABS: { id: Tab; name: string; icon: typeof Map }[] = [
  { id: "plan", name: "여행 일정", icon: CalendarDays },
  { id: "places", name: "저장한 장소", icon: MapPin },
  { id: "expenses", name: "여행 경비", icon: Wallet },
  { id: "checklist", name: "체크리스트", icon: ListChecks },
  { id: "members", name: "함께하는 친구", icon: Users },
];
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown) => Number(value) || 0;
const newId = () => globalThis.crypto.randomUUID();
const dayFormat = (value: string, long = false) => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        ...(long ? { weekday: "short" as const } : {}),
      }).format(date);
};
function daysBetween(start: string, end: string) {
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (!Number.isFinite(+a) || !Number.isFinite(+b) || b < a) return [];
  return Array.from({ length: Math.min(366, Math.round((+b - +a) / 86400000) + 1) }, (_, i) => {
    const d = new Date(a);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "KRW",
    maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
  }).format(amount);
const tripDate = (trip: Trip) =>
  `${trip.startDate.replaceAll("-", ".")} — ${trip.endDate.slice(5).replaceAll("-", ".")}`;
function sampleWorkspace(): Workspace {
  const sampleId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const now = new Date().toISOString();
  const trip: Trip = {
    id: "demo-jeju",
    title: "제주, 느리게 걷는 여행",
    destination: "제주도, 대한민국",
    startDate: "2027-05-21",
    endDate: "2027-05-23",
    currency: "KRW",
    role: "owner",
    version: 1,
    timezone: "Asia/Seoul",
    revision: 1,
    memberCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  const rows: { kind: ItemKind; data: Record<string, unknown> }[] = [
    {
      kind: "place",
      data: {
        name: "함덕해수욕장",
        address: "제주시 조천읍 조함해안로 525",
        lat: 33.5432,
        lng: 126.6692,
        category: "자연",
        note: "파도 소리 들으며 산책하기",
      },
    },
    {
      kind: "place",
      data: {
        name: "동문시장",
        address: "제주시 관덕로14길 20",
        lat: 33.5116,
        lng: 126.5262,
        category: "맛집",
        note: "저녁거리와 간식 사기",
      },
    },
    {
      kind: "place",
      data: {
        name: "성산일출봉",
        address: "서귀포시 성산읍 성산리 1",
        lat: 33.4582,
        lng: 126.9425,
        category: "자연",
        note: "편한 신발 챙기기",
      },
    },
    {
      kind: "plan",
      data: {
        date: "2027-05-21",
        time: "10:30",
        title: "제주공항 도착",
        category: "이동",
        note: "렌터카 픽업 후, 우리 여행 시작!",
        duration: "60",
      },
    },
    {
      kind: "plan",
      data: {
        date: "2027-05-21",
        time: "12:00",
        title: "바다를 보며 첫 점심",
        category: "맛집",
        note: "함덕 근처에서 고기국수 먹기",
        duration: "60",
      },
    },
    {
      kind: "plan",
      data: {
        date: "2027-05-21",
        time: "14:00",
        title: "함덕해수욕장 산책",
        category: "자연",
        note: "에메랄드빛 바다를 천천히 걷자",
        duration: "90",
        placeId: sampleId(0),
      },
    },
    {
      kind: "plan",
      data: {
        date: "2027-05-21",
        time: "17:00",
        title: "동문시장에서 저녁 장보기",
        category: "쇼핑",
        note: "귤과 회 포장해서 숙소로",
        duration: "60",
        placeId: sampleId(1),
      },
    },
    {
      kind: "plan",
      data: {
        date: "2027-05-22",
        time: "09:00",
        title: "성산일출봉 오르기",
        category: "자연",
        note: "정상에서 함께 사진 남기기",
        duration: "120",
        placeId: sampleId(2),
      },
    },
    {
      kind: "expense",
      data: {
        title: "렌터카 3일",
        amount: 150000,
        currency: "KRW",
        category: "교통",
        payer: "나",
        participants: ["나", "친구"],
        date: "2027-05-21",
      },
    },
    {
      kind: "expense",
      data: {
        title: "함덕 점심",
        amount: 28000,
        currency: "KRW",
        category: "식비",
        payer: "친구",
        participants: ["나", "친구"],
        date: "2027-05-21",
      },
    },
    { kind: "checklist", data: { title: "항공권 예약", category: "예약", done: true } },
    { kind: "checklist", data: { title: "숙소 예약 확인", category: "예약", done: true } },
    { kind: "checklist", data: { title: "보조배터리와 충전기", category: "짐 싸기", done: false } },
    { kind: "checklist", data: { title: "편한 운동화", category: "짐 싸기", done: false } },
  ];
  return {
    trip,
    records: rows.map((r, i) => ({
      id: sampleId(i),
      kind: r.kind,
      data: r.data,
      version: 1,
      updatedAt: now,
      updatedBy: "local",
    })),
    members: [],
    revision: 1,
  };
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = container.current;
    node?.querySelector<HTMLElement>("input,button,select,textarea")?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && node) {
        const nodes = Array.from(
          node.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={container}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <IconButton label="닫기" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TripApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [localTrips, setLocalTrips] = useState<StoredTrip[]>([]);
  const [sharedTrips, setSharedTrips] = useState<Trip[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [mode, setMode] = useState<Mode>("local");
  const [tab, setTab] = useState<Tab>("plan");
  const [date, setDate] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(true);
  const [search, setSearch] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [mapPlace, setMapPlace] = useState<string | null>(null);
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const mutatingRef = useRef(false);
  const importRef = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  const closeModal = useCallback(() => {
    if (!saving) {
      setModal(null);
      setFormError("");
    }
  }, [saving]);
  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 7000);
  }, []);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (Array.isArray(saved))
          setLocalTrips(
            saved.filter((x) => x?.workspace?.trip && Array.isArray(x.workspace.records)),
          );
      } catch {
        /* fresh local store */
      }
      setOnline(navigator.onLine);
      const match = location.pathname.match(/^\/invite\/([^/]+)\/?$/);
      if (match) setJoinToken(match[1]);
    });
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    api<{ user: User | null }>("/api/me")
      .then((value) => setUser(value.user))
      .catch(() => flash("로그인 연결을 확인하지 못했습니다. 이 기기에서 여행을 만들 수 있어요."))
      .finally(() => setAuthReady(true));
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [flash]);
  useEffect(() => {
    if (user)
      api<{ trips: Trip[] }>("/api/trips")
        .then((r) => setSharedTrips(r.trips))
        .catch((e) => flash(e.message));
  }, [user, flash]);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void getSupabaseClient()
      .then((client) => {
        if (!client || cancelled) return;
        const subscription = client.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")
            setTimeout(() => {
              void api<{ user: User | null }>("/api/me")
                .then((r) => setUser(r.user))
                .catch(() => {});
            }, 0);
          if (event === "SIGNED_OUT") {
            setUser(null);
            setSharedTrips([]);
            if (workspaceRef.current && mode === "shared") setWorkspace(null);
          }
        });
        dispose = () => subscription.data.subscription.unsubscribe();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [mode]);
  async function authenticated() {
    try {
      const result = await api<{ user: User | null }>("/api/me");
      setUser(result.user);
      setAuthOpen(false);
      flash("로그인했습니다. 이제 공유 여행을 만들 수 있어요.");
    } catch (e) {
      flash((e as Error).message);
    }
  }
  const persistLocal = useCallback((next: StoredTrip[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setLocalTrips(next);
    } catch {
      throw new Error(
        "이 기기의 저장 공간이 부족하거나 저장이 차단되었습니다. JSON으로 백업해 주세요.",
      );
    }
  }, []);
  function acceptWorkspace(next: Workspace) {
    setWorkspace(next);
    if (user)
      try {
        localStorage.setItem(`tripboogie-cache:${user.id}:${next.trip.id}`, JSON.stringify(next));
      } catch {
        /* server has persisted this result */
      }
    setSharedTrips((old) =>
      old.some((t) => t.id === next.trip.id)
        ? old.map((t) => (t.id === next.trip.id ? next.trip : t))
        : [...old, next.trip],
    );
  }
  const handleAccessLoss = useCallback(
    (error: unknown, tripId: string) => {
      const status = (error as { status?: number }).status;
      if (status !== 401 && status !== 403 && status !== 404) return false;
      if (user)
        for (const key of Object.keys(localStorage))
          if (
            key === `tripboogie-cache:${user.id}:${tripId}` ||
            (status === 401 && key.startsWith(`tripboogie-cache:${user.id}:`))
          )
            localStorage.removeItem(key);
      setWorkspace((current) => (current?.trip.id === tripId ? null : current));
      if (workspaceRef.current?.trip.id === tripId || status === 401) {
        setModal(null);
        setConflict(false);
      }
      setSharedTrips((current) => (status === 401 ? [] : current.filter((t) => t.id !== tripId)));
      if (status === 401) setUser(null);
      flash(
        status === 401
          ? "로그인이 만료되었어요. 다시 로그인해 주세요."
          : "여행을 볼 수 있는 권한이 변경되어 여행을 닫았습니다.",
      );
      return true;
    },
    [user, flash],
  );
  const refresh = useCallback(async () => {
    const current = workspaceRef.current;
    if (!current) return;
    try {
      const next = await api<Workspace>(`/api/trips/${current.trip.id}`);
      setWorkspace(next);
      setConflict(false);
    } catch (error) {
      if (!handleAccessLoss(error, current.trip.id))
        flash(error instanceof Error ? error.message : "새로 불러오지 못했습니다.");
    }
  }, [flash, handleAccessLoss]);
  const activeWorkspaceId = workspace?.trip.id;
  useEffect(() => {
    if (!activeWorkspaceId || mode !== "shared" || modal || saving || !online) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || mutatingRef.current) return;
      const requestedId = activeWorkspaceId;
      void api<Workspace>(`/api/trips/${requestedId}`)
        .then((next) => {
          if (mutatingRef.current) return;
          setWorkspace((current) =>
            current?.trip.id === next.trip.id && next.revision >= current.revision ? next : current,
          );
        })
        .catch((error) => {
          handleAccessLoss(error, requestedId);
        });
    }, 8000);
    return () => clearInterval(id);
  }, [activeWorkspaceId, mode, modal, saving, online, handleAccessLoss]);
  async function openTrip(trip: Trip, nextMode: Mode) {
    setTab("plan");
    setDate(trip.startDate);
    setMapPlace(null);
    setMode(nextMode);
    setConflict(false);
    if (nextMode !== "shared") {
      const stored = localTrips.find((t) => t.workspace.trip.id === trip.id);
      if (stored) setWorkspace(stored.workspace);
      return;
    }
    setLoading(true);
    try {
      acceptWorkspace(await api<Workspace>(`/api/trips/${trip.id}`));
    } catch (error) {
      if (handleAccessLoss(error, trip.id)) return;
      const status = (error as { status?: number }).status;
      const cached =
        user && !status ? localStorage.getItem(`tripboogie-cache:${user.id}:${trip.id}`) : null;
      if (cached) {
        setWorkspace(JSON.parse(cached));
        flash("저장된 사본을 열었습니다. 연결 후 최신 내용을 불러오세요.");
      } else flash(error instanceof Error ? error.message : "여행을 열 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }
  function saveLocal(next: Workspace) {
    const list = [...localTrips];
    const index = list.findIndex((t) => t.workspace.trip.id === next.trip.id);
    const value = {
      workspace: next,
      mode: mode === "demo" ? ("demo" as const) : ("local" as const),
    };
    if (index >= 0) list[index] = value;
    else list.unshift(value);
    persistLocal(list);
    setWorkspace(next);
  }
  const readOnly =
    mode === "shared" &&
    ((workspace?.trip as Trip & { role?: string })?.role === "viewer" || !online);
  async function mutate(
    action: "upsert" | "delete" | "update-trip",
    kind?: string,
    data?: Record<string, unknown>,
    record?: ItemRecord,
  ) {
    if (!workspace) return;
    if (readOnly) throw new Error("이 여행은 현재 읽기 전용입니다.");
    if (mutatingRef.current)
      throw new Error("앞선 변경을 저장하는 중이에요. 잠시 후 다시 시도해 주세요.");
    if (action === "upsert" && kind) {
      data = itemData(kind as ItemKind, data);
      if (kind === "plan") {
        if (str(data.date) < workspace.trip.startDate || str(data.date) > workspace.trip.endDate)
          throw new Error("일정 날짜는 여행 기간 안에 있어야 합니다.");
        if (
          data.placeId &&
          !workspace.records.some((r) => r.id === data?.placeId && r.kind === "place")
        )
          throw new Error("연결한 장소를 찾을 수 없어요. 장소를 다시 선택해 주세요.");
      }
    }
    if (
      action === "delete" &&
      record?.kind === "place" &&
      workspace.records.some((r) => r.kind === "plan" && r.data.placeId === record.id)
    )
      throw new Error("이 장소를 연결한 일정이 있어요. 일정의 장소 연결을 먼저 해제해 주세요.");
    if (action === "update-trip") {
      data = tripData({ ...workspace.trip, ...data });
      if (
        workspace.records.some(
          (r) =>
            r.kind === "plan" &&
            (str(r.data.date) < str(data?.startDate) || str(r.data.date) > str(data?.endDate)),
        )
      )
        throw new Error("변경한 기간 밖에 일정이 있어요. 해당 일정을 먼저 옮겨 주세요.");
    }
    mutatingRef.current = true;
    try {
      if (mode === "shared") {
        try {
          const next = await api<Workspace>(`/api/trips/${workspace.trip.id}`, {
            method: "POST",
            body: JSON.stringify({
              action,
              kind,
              data,
              id: record?.id,
              version: action === "update-trip" ? workspace.trip.version : record?.version,
            }),
          });
          acceptWorkspace(next);
          setConflict(false);
        } catch (error) {
          if ((error as { status?: number }).status === 409) setConflict(true);
          handleAccessLoss(error, workspace.trip.id);
          throw error;
        }
      } else {
        const next: Workspace = {
          ...workspace,
          records: [...workspace.records],
          revision: num(workspace.revision) + 1,
        };
        if (action === "update-trip")
          next.trip = {
            ...next.trip,
            ...data,
            version: next.trip.version + 1,
            updatedAt: new Date().toISOString(),
          } as Trip;
        else if (action === "delete")
          next.records = next.records.filter((r) => r.id !== record?.id);
        else {
          const row: ItemRecord = {
            id: record?.id || newId(),
            kind: kind as ItemKind,
            data: data || {},
            version: (record?.version || 0) + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: "local",
          };
          next.records = next.records.filter((r) => r.id !== row.id).concat(row);
        }
        saveLocal(next);
      }
    } finally {
      mutatingRef.current = false;
    }
  }
  async function removeMember(member: Member) {
    if (!workspace || activeTrip?.role !== "owner" || member.role === "owner") return;
    if (!window.confirm(`${member.name || member.email || "이 친구"}의 여행 참여를 해제할까요?`))
      return;
    setSaving(true);
    mutatingRef.current = true;
    try {
      await api(`/api/trips/${workspace.trip.id}/members/${member.id}`, { method: "DELETE" });
      await refresh();
      flash("친구의 여행 참여를 해제했습니다.");
    } catch (error) {
      if (!handleAccessLoss(error, workspace.trip.id)) flash((error as Error).message);
    } finally {
      setSaving(false);
      mutatingRef.current = false;
    }
  }
  async function removeRecord(record: ItemRecord) {
    if (!window.confirm(`“${str(record.data.title, str(record.data.name))}” 항목을 삭제할까요?`))
      return;
    try {
      await mutate("delete", record.kind, undefined, record);
      flash("항목을 삭제했습니다.");
    } catch (e) {
      flash((e as Error).message);
    }
  }
  const openModal = (type: NonNullable<Modal>["type"], record?: ItemRecord) => {
    setFormError("");
    setInviteUrl("");
    setModal({ type, record });
    if (type === "invite" && workspace && mode === "shared")
      api<{ invites: Invite[] }>(`/api/trips/${workspace.trip.id}/invites`)
        .then((r) => setInvites(r.invites))
        .catch((e) => setFormError(e.message));
  };
  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<
      string,
      string
    >;
    setSaving(true);
    setFormError("");
    try {
      if (modal.type === "trip") {
        if (values.endDate < values.startDate)
          throw new Error("마지막 날짜는 시작 날짜 이후여야 합니다.");
        if (daysBetween(values.startDate, values.endDate).length >= 366)
          throw new Error("한 여행은 최대 365일로 나눠 만들어 주세요.");
        const data = tripData({
          title: values.title.trim(),
          destination: values.destination.trim(),
          startDate: values.startDate,
          endDate: values.endDate,
          currency: values.currency,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
        });
        if (values.storage === "shared") {
          if (!user) throw new Error("함께 편집하려면 먼저 로그인해 주세요.");
          const result = await api<Workspace | { trip: Trip }>("/api/trips", {
            method: "POST",
            body: JSON.stringify(data),
          });
          const created =
            "records" in result ? result : await api<Workspace>(`/api/trips/${result.trip.id}`);
          setMode("shared");
          acceptWorkspace(created);
          setDate(data.startDate);
          setTab("plan");
        } else {
          const now = new Date().toISOString();
          const next: Workspace = {
            trip: {
              ...data,
              id: newId(),
              role: "owner",
              version: 1,
              revision: 1,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
              memberCount: 1,
              updatedAt: now,
              createdAt: now,
            },
            records: [],
            members: [],
            revision: 1,
          };
          persistLocal([{ workspace: next, mode: "local" }, ...localTrips]);
          setMode("local");
          setWorkspace(next);
          setDate(data.startDate);
          setTab("plan");
        }
      } else if (modal.type === "settings") {
        if (values.endDate < values.startDate) throw new Error("날짜를 다시 확인해 주세요.");
        if (daysBetween(values.startDate, values.endDate).length >= 366)
          throw new Error("한 여행은 최대 365일로 설정해 주세요.");
        const outOfRange = workspace?.records.some(
          (r) =>
            r.kind === "plan" &&
            (str(r.data.date) < values.startDate || str(r.data.date) > values.endDate),
        );
        if (outOfRange)
          throw new Error(
            "변경한 기간 밖에 일정이 있어요. 해당 일정을 먼저 옮기거나 삭제해 주세요.",
          );
        await mutate("update-trip", undefined, values);
      } else if (modal.type === "invite") {
        if (!workspace) return;
        const result = await api<{ url: string; expiresAt: string }>(
          `/api/trips/${workspace.trip.id}/invites`,
          { method: "POST", body: JSON.stringify({ role: values.role }) },
        );
        setInviteUrl(result.url);
        const list = await api<{ invites: Invite[] }>(`/api/trips/${workspace.trip.id}/invites`);
        setInvites(list.invites);
        return;
      } else {
        const data: Record<string, unknown> = { ...values };
        if (modal.type === "expense") {
          if (!(Number(values.amount) > 0)) throw new Error("금액은 0보다 커야 합니다.");
          data.amount = Number(values.amount);
          data.participants = values.participants
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (!(data.participants as string[]).length)
            throw new Error("나눌 사람을 한 명 이상 입력해 주세요.");
        }
        if (modal.type === "place") {
          if ((values.lat === "") !== (values.lng === ""))
            throw new Error("위도와 경도를 함께 입력해 주세요.");
          if (values.lat !== "") {
            data.lat = Number(values.lat);
            data.lng = Number(values.lng);
            if (Math.abs(Number(data.lat)) > 90 || Math.abs(Number(data.lng)) > 180)
              throw new Error("위도와 경도 범위를 확인해 주세요.");
          } else {
            delete data.lat;
            delete data.lng;
          }
        }
        if (modal.type === "checklist") data.done = modal.record?.data.done === true;
        await mutate("upsert", modal.type, data, modal.record);
      }
      setModal(null);
      flash(
        (modal.type === "trip" ? values.storage === "shared" : mode === "shared")
          ? "온라인 여행에 저장했습니다."
          : "이 기기에 저장했습니다.",
      );
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function openSample() {
    const existing = localTrips.find((t) => t.mode === "demo");
    const next = existing?.workspace ?? sampleWorkspace();
    setMode("demo");
    setWorkspace(next);
    setDate(next.trip.startDate);
    setTab("plan");
    if (!existing) persistLocal([...localTrips, { workspace: next, mode: "demo" }]);
  }
  function exportTrip() {
    if (!workspace) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { format: "tripboogie-v1", exportedAt: new Date().toISOString(), workspace },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${workspace.trip.title}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }
  async function importTrip(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error("5MB 이하의 JSON 백업을 선택해 주세요.");
      const value = JSON.parse(await file.text());
      const source = value.workspace;
      if (value.format !== "tripboogie-v1" || !source?.trip || !Array.isArray(source.records))
        throw new Error("트립부기에서 내보낸 JSON 백업을 선택해 주세요.");
      const t = source.trip;
      if (
        ![t.title, t.destination, t.startDate, t.endDate, t.currency].every(
          (v) => typeof v === "string",
        ) ||
        !daysBetween(t.startDate, t.endDate).length ||
        t.startDate > t.endDate
      )
        throw new Error("여행 정보 형식이 올바르지 않습니다.");
      tripData(t);
      if (
        source.records.length > 5000 ||
        source.records.some(
          (r: ItemRecord) =>
            !["plan", "place", "expense", "checklist"].includes(r.kind) ||
            typeof r.id !== "string" ||
            !r.data ||
            typeof r.data !== "object",
        )
      )
        throw new Error("항목 형식 또는 개수를 확인해 주세요.");
      const normalizedRecords = source.records.map((r: ItemRecord) => ({
        ...r,
        data: itemData(r.kind, r.data),
      }));
      if (
        normalizedRecords.some(
          (r: ItemRecord) =>
            r.kind === "plan" &&
            (str(r.data.date) < t.startDate ||
              str(r.data.date) > t.endDate ||
              (r.data.placeId &&
                !normalizedRecords.some(
                  (p: ItemRecord) => p.kind === "place" && p.id === r.data.placeId,
                ))),
        )
      )
        throw new Error("일정의 날짜나 연결한 장소를 확인해 주세요.");
      const next = {
        ...source,
        records: normalizedRecords,
        trip: { ...t, id: newId(), role: "owner" },
        members: [],
      } as Workspace;
      persistLocal([{ workspace: next, mode: "local" }, ...localTrips]);
      setMode("local");
      setWorkspace(next);
      setDate(next.trip.startDate);
      flash("이 기기의 새 여행으로 가져왔습니다.");
    } catch (e) {
      flash((e as Error).message);
    }
  }
  async function joinTrip() {
    if (!joinToken) return;
    setSaving(true);
    try {
      const result = await api<Workspace | { tripId: string }>(`/api/invites/${joinToken}`, {
        method: "POST",
      });
      const next =
        "records" in result ? result : await api<Workspace>(`/api/trips/${result.tripId}`);
      setMode("shared");
      acceptWorkspace(next);
      setDate(next.trip.startDate);
      setJoinToken(null);
      history.replaceState(null, "", "/");
      flash("여행에 참여했습니다.");
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const records = workspace?.records || [];
  const plans = records.filter((r) => r.kind === "plan");
  const places = records.filter((r) => r.kind === "place");
  const expenses = records.filter((r) => r.kind === "expense");
  const checks = records.filter((r) => r.kind === "checklist");
  const days = workspace ? daysBetween(workspace.trip.startDate, workspace.trip.endDate) : [];
  const currentDate = days.includes(date) ? date : days[0];
  const currentPlans = plans
    .filter((r) => str(r.data.date) === currentDate)
    .sort((a, b) => str(a.data.time).localeCompare(str(b.data.time)));
  const visibleTrips = [
    ...sharedTrips.map((trip) => ({ trip, mode: "shared" as Mode })),
    ...localTrips
      .filter((t) => t.mode !== "demo")
      .map((t) => ({ trip: t.workspace.trip, mode: "local" as Mode })),
  ].filter(({ trip }) =>
    `${trip.title} ${trip.destination}`.toLowerCase().includes(search.toLowerCase()),
  );
  const totals = expenses.reduce<Record<string, number>>((all, row) => {
    const currency = str(row.data.currency, workspace?.trip.currency || "KRW");
    all[currency] = (all[currency] || 0) + num(row.data.amount);
    return all;
  }, {});
  const activeTrip = workspace?.trip;
  const modalData = modal?.record?.data || {};
  const modalTitle = modal
    ? {
        trip: "새로운 여행 만들기",
        plan: modal.record ? "일정 수정" : "설레는 일정 추가",
        place: modal.record ? "장소 수정" : "마음에 든 장소 저장",
        expense: modal.record ? "경비 수정" : "여행 경비 기록",
        checklist: modal.record ? "준비 항목 수정" : "챙길 것 추가",
        settings: "여행 설정",
        invite: "친구와 함께 준비하기",
      }[modal.type]
    : "";
  const selectedMapPlace =
    places.find((p) => p.id === mapPlace) ||
    places.find((p) => p.data.lat != null && p.data.lng != null);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setWorkspace(null)}>
          <span className="brand-icon">
            <Image src="/turtle-mascot.png" alt="" width={48} height={48} />
          </span>
          <span className="brand-wordmark">
            TripBoogie<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="sidebar-label">YOUR PRIVATE JOURNEY</div>
        <button
          className={`side-nav ${!workspace ? "active" : ""}`}
          onClick={() => setWorkspace(null)}
        >
          <LayoutGrid size={19} />
          나의 여행
          <ChevronRight size={15} />
        </button>
        {workspace && (
          <div className="trip-nav-group">
            <span className="sidebar-label">이번 여행</span>
            <p className="sidebar-trip-name">{workspace.trip.title}</p>
            {TABS.map((item) => (
              <button
                key={item.id}
                className={`side-nav ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                <item.icon size={18} />
                {item.name}
                {item.id === "checklist" && checks.length > 0 && (
                  <span className="nav-count">{checks.filter((r) => !r.data.done).length}</span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={23} />
            <strong>우리만의 여행 공간</strong>
            <p>
              함께 가는 사람에게만 공유해요.
              <br />
              낯선 사람의 피드와 리뷰 없이.
            </p>
          </div>
          <button className="side-nav subtle" onClick={() => importRef.current?.click()}>
            <ArrowDownToLine size={17} />
            백업 가져오기
          </button>
          <div className="profile">
            <span className="avatar">
              {user ? user.name?.[0] || user.email?.[0] || "나" : "나"}
            </span>
            <div>
              <strong>{user ? user.name || user.email.split("@")[0] : "나의 여행자 공간"}</strong>
              <small>{user ? "로그인됨" : "이 기기에 저장 중"}</small>
            </div>
            {user ? (
              <button
                className="profile-auth-button"
                onClick={() => {
                  void signOut().catch((e) => flash(e.message));
                }}
                aria-label="로그아웃"
                title="로그아웃"
              >
                <ArrowUpRight size={16} />
              </button>
            ) : (
              <button
                className="profile-auth-button"
                onClick={() => setAuthOpen(true)}
                aria-label="로그인"
                title="로그인"
              >
                <LogIn size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Image src="/turtle-mascot.png" alt="" width={32} height={32} />
              TripBoogie
            </span>
            <span className="desktop-only">나의 여행</span>
            {activeTrip && (
              <>
                <ChevronRight size={14} />
                <span className="breadcrumb-trip">{activeTrip.title}</span>
              </>
            )}
          </div>
          <div className="top-actions">
            <span className={`sync-state ${!online ? "offline" : ""}`}>
              {!online ? (
                <WifiOff size={14} />
              ) : mode === "shared" && workspace ? (
                <Cloud size={14} />
              ) : (
                <ShieldCheck size={14} />
              )}
              {!online
                ? "오프라인"
                : mode === "shared" && workspace
                  ? "온라인 공유 여행"
                  : "로컬 저장"}
            </span>
            {user ? (
              <span className="avatar small">{user.name?.[0] || "나"}</span>
            ) : (
              <button
                className="text-link login-link"
                onClick={() => setAuthOpen(true)}
                disabled={!authReady}
              >
                로그인
                <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div className="toast" role="status">
            <CheckCheck size={18} />
            {notice}
            <button onClick={() => setNotice("")} aria-label="알림 닫기">
              <X size={15} />
            </button>
          </div>
        )}
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importTrip(file);
            e.target.value = "";
          }}
        />
        {conflict && (
          <div className="alert conflict" role="alert">
            친구가 이 항목을 먼저 수정했어요. 작성 내용은 열어 둔 창에 남아 있습니다.
            <button
              onClick={() => {
                void refresh();
              }}
            >
              최신 내용 불러오기
            </button>
          </div>
        )}
        {loading && (
          <div className="loading-bar">
            <LoaderCircle size={16} className="spin" />
            여행을 불러오는 중
          </div>
        )}
        {!workspace ? (
          <main className="dashboard">
            <div className="page-kicker">
              <span />A LITTLE PLAN, A GREAT JOURNEY
            </div>
            <div className="dashboard-heading">
              <div>
                <h1>
                  여행을, <em>우리답게.</em>
                </h1>
                <p>
                  가고 싶은 곳부터 작은 준비까지.
                  <br className="mobile-only" /> 마음 맞는 친구와 한곳에 모아보세요.
                </p>
              </div>
              <button className="primary-button" onClick={() => openModal("trip")}>
                <Plus size={19} />새 여행 만들기
              </button>
            </div>
            <section className="welcome-banner">
              <div className="welcome-copy">
                <span className="eyebrow">MADE FOR YOU & YOUR PEOPLE</span>
                <h2>
                  계획하는 순간부터
                  <br />
                  여행은 시작되니까.
                </h2>
                <p>
                  일정, 장소, 경비를 함께 정리하고
                  <br />
                  우리에게 꼭 맞는 여행을 만들어보세요.
                </p>
                <button onClick={openSample}>
                  샘플 여행 둘러보기
                  <ArrowRight size={17} />
                </button>
              </div>
              <div className="journey-art" aria-hidden="true">
                <div className="art-sun" />
                <Image
                  className="hero-turtle"
                  src="/turtle-mascot.png"
                  alt=""
                  width={285}
                  height={285}
                  priority
                />
                <div className="art-orbit" />
                <div className="art-island" />
                <div className="art-island second" />
                <div className="art-route">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="art-ticket">
                  <Plane size={18} />
                  <span>
                    YOUR NEXT
                    <br />
                    <b>ADVENTURE</b>
                  </span>
                  <span className="ticket-line" />
                </div>
                <div className="art-tag">
                  <MapPin size={15} />
                  NEXT STOP, SOMEWHERE NEW
                </div>
                <div className="art-compass">
                  <Compass size={37} strokeWidth={1} />
                </div>
              </div>
            </section>
            <section className="my-trips">
              <div className="section-heading">
                <div>
                  <h2>
                    나의 여행 <span>{visibleTrips.length.toString().padStart(2, "0")}</span>
                  </h2>
                  <p>함께 쌓아가는 우리만의 여행 기록</p>
                </div>
                <label className="search-box">
                  <Search size={17} />
                  <input
                    aria-label="여행 검색"
                    placeholder="여행 이름, 목적지 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              {visibleTrips.length ? (
                <div className="trip-grid">
                  {visibleTrips.map(({ trip, mode: cardMode }) => (
                    <button
                      className="trip-card"
                      key={trip.id}
                      onClick={() => {
                        void openTrip(trip, cardMode);
                      }}
                    >
                      <div className={`trip-art art-${(trip.title.length % 3) + 1}`}>
                        <span className="trip-card-badge">
                          {cardMode === "shared" ? <Users size={13} /> : <ShieldCheck size={13} />}{" "}
                          {cardMode === "shared" ? "함께하는 여행" : "나만의 여행"}
                        </span>
                        <Compass size={88} strokeWidth={0.7} />
                        <span className="trip-art-title">{trip.destination.split(",")[0]}</span>
                      </div>
                      <div className="trip-card-content">
                        <span className="trip-location">
                          <MapPin size={13} />
                          {trip.destination}
                        </span>
                        <h3>
                          {trip.title}
                          <ArrowUpRight size={17} />
                        </h3>
                        <p>
                          {tripDate(trip)}
                          <span>{daysBetween(trip.startDate, trip.endDate).length}일</span>
                        </p>
                      </div>
                    </button>
                  ))}
                  <button className="new-trip-card" onClick={() => openModal("trip")}>
                    <span>
                      <Plus size={25} />
                    </span>
                    <strong>다음 여행을 계획해 볼까요?</strong>
                    <small>새로운 설렘을 추가해요</small>
                  </button>
                </div>
              ) : (
                <div className="empty-trips">
                  <div className="empty-trip-icon">
                    <Plane size={28} strokeWidth={1.3} />
                  </div>
                  <div>
                    <h3>{search ? "찾는 여행이 아직 없어요" : "아직 비어 있는 여행 노트"}</h3>
                    <p>
                      {search
                        ? "다른 여행 이름이나 목적지로 검색해 보세요."
                        : "첫 여행을 만들면 일정과 장소, 경비를 한곳에서 관리할 수 있어요."}
                    </p>
                  </div>
                  <button
                    className="outlined-button"
                    onClick={() => (search ? setSearch("") : openModal("trip"))}
                  >
                    {search ? "검색 초기화" : "첫 여행 만들기"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
            <div className="feature-strip">
              <div>
                <MapPin size={22} />
                <span>
                  <strong>발길 닿는 곳을 모으고</strong>
                  <small>Google 지도로 장소 확인</small>
                </span>
              </div>
              <div>
                <Users size={22} />
                <span>
                  <strong>마음 맞는 친구와 함께</strong>
                  <small>초대받은 사람만 함께 편집</small>
                </span>
              </div>
              <div>
                <ShieldCheck size={22} />
                <span>
                  <strong>내 데이터는 내 손에</strong>
                  <small>로컬 저장과 JSON 백업</small>
                </span>
              </div>
            </div>
            <footer className="dashboard-footer">
              <span>트립부기 — 함께 만드는, 우리만의 여행.</span>
              <span>LESS SCROLLING. MORE EXPLORING.</span>
            </footer>
          </main>
        ) : (
          <main className="trip-workspace">
            <div className="trip-title-row">
              <div>
                <button className="back-link" onClick={() => setWorkspace(null)}>
                  <ArrowLeft size={14} />
                  여행 목록
                </button>
                <div className="trip-location">
                  <MapPin size={14} />
                  {activeTrip?.destination}
                </div>
                <h1>{activeTrip?.title}</h1>
                <div className="trip-meta">
                  <span>
                    <CalendarDays size={15} />
                    {activeTrip && tripDate(activeTrip)}
                  </span>
                  <span className="days-tag">
                    {days.length - 1}박 {days.length}일
                  </span>
                  <span className={`mode-badge ${mode === "demo" ? "demo" : ""}`}>
                    {mode === "demo"
                      ? "샘플 · 이 기기에만 저장"
                      : mode === "shared"
                        ? "친구와 공유"
                        : "이 기기에만 저장"}
                  </span>
                </div>
              </div>
              <div className="trip-header-actions">
                <IconButton label="여행 백업 내보내기" onClick={exportTrip}>
                  <ArrowDownToLine size={19} />
                </IconButton>
                <IconButton
                  label="여행 설정"
                  onClick={() => openModal("settings")}
                  disabled={readOnly}
                >
                  <Settings2 size={19} />
                </IconButton>
                <button
                  className="primary-button compact"
                  onClick={() => {
                    setTab("members");
                    if (mode === "shared" && activeTrip?.role === "owner") openModal("invite");
                  }}
                >
                  <Users size={16} />
                  친구 초대
                </button>
              </div>
            </div>
            <nav className="workspace-tabs" aria-label="여행 메뉴">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  <item.icon size={17} />
                  {item.name}
                </button>
              ))}
            </nav>
            {mode === "demo" && (
              <div className="demo-notice">
                <Sparkles size={15} />
                <span>샘플 여행이에요. 자유롭게 수정해 보세요. 실제 친구와 공유되지 않습니다.</span>
                <button onClick={() => openModal("trip")}>
                  내 여행 만들기
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
            {readOnly && (
              <div className="alert">
                <ShieldCheck size={16} />
                {!online
                  ? "저장된 여행을 보고 있어요. 다시 연결하면 편집할 수 있습니다."
                  : "보기 권한으로 참여하고 있어요. 여행 내용을 확인할 수 있습니다."}
              </div>
            )}
            {tab === "plan" && (
              <div className="planner-layout">
                <section className="itinerary-panel">
                  <div className="itinerary-head">
                    <div>
                      <span className="eyebrow muted">OUR LITTLE ADVENTURE</span>
                      <h2>하루를 채우는 순간들</h2>
                    </div>
                    <button
                      className="outlined-button compact"
                      disabled={readOnly}
                      onClick={() => openModal("plan")}
                    >
                      <Plus size={16} />
                      일정 추가
                    </button>
                  </div>
                  <div className="day-tabs">
                    {days.map((day, i) => (
                      <button
                        key={day}
                        onClick={() => setDate(day)}
                        className={currentDate === day ? "active" : ""}
                      >
                        <strong>DAY {i + 1}</strong>
                        <span>{dayFormat(day)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="day-heading">
                    <h3>{dayFormat(currentDate, true)}</h3>
                    <span>{currentPlans.length}개의 일정</span>
                  </div>
                  <div className="timeline">
                    {currentPlans.length ? (
                      currentPlans.map((row, i) => {
                        const place = places.find((p) => p.id === row.data.placeId);
                        return (
                          <article className="timeline-item" key={row.id}>
                            <div className="timeline-mark">
                              <span>{i + 1}</span>
                              {i < currentPlans.length - 1 && <i />}
                            </div>
                            <div className="timeline-card">
                              <div className="timeline-card-top">
                                <span className="time">{str(row.data.time, "시간 미정")}</span>
                                <span className={`category category-${str(row.data.category)}`}>
                                  {str(row.data.category, "일정")}
                                </span>
                                <div className="row-actions">
                                  <IconButton
                                    label={`${str(row.data.title)} 수정`}
                                    onClick={() => openModal("plan", row)}
                                    disabled={readOnly}
                                  >
                                    <Pencil size={14} />
                                  </IconButton>
                                  <IconButton
                                    label={`${str(row.data.title)} 삭제`}
                                    onClick={() => {
                                      void removeRecord(row);
                                    }}
                                    disabled={readOnly}
                                  >
                                    <Trash2 size={14} />
                                  </IconButton>
                                </div>
                              </div>
                              <h4>{str(row.data.title)}</h4>
                              {row.data.note ? <p>{str(row.data.note)}</p> : null}
                              <div className="timeline-card-bottom">
                                {place ? (
                                  <button
                                    className="place-link"
                                    onClick={() => {
                                      setMapPlace(place.id);
                                      setTab("places");
                                    }}
                                  >
                                    <MapPin size={13} />
                                    {str(place.data.name)}
                                  </button>
                                ) : (
                                  <span />
                                )}
                                {row.data.duration ? (
                                  <span>{String(row.data.duration)}분 머무르기</span>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="content-empty">
                        <CalendarDays size={31} />
                        <h3>아직 정해진 일정이 없어요</h3>
                        <p>꼭 하고 싶은 일부터 하나씩 채워보세요.</p>
                        <button
                          className="outlined-button"
                          onClick={() => openModal("plan")}
                          disabled={readOnly}
                        >
                          <Plus size={16} />첫 일정 추가하기
                        </button>
                      </div>
                    )}
                    <button
                      className="add-timeline"
                      onClick={() => openModal("plan")}
                      disabled={readOnly}
                    >
                      <Plus size={17} />
                      새로운 순간 추가하기
                    </button>
                  </div>
                </section>
                <aside className="map-sidebar">
                  <MapPanel places={places} selectedPlaceId={selectedMapPlace?.id} />
                  <div className="travel-note">
                    <span className="note-spark">
                      <Sparkles size={19} />
                    </span>
                    <span className="eyebrow">A NOTE FOR YOUR JOURNEY</span>
                    <h3>조금 느려도 괜찮아요.</h3>
                    <p>
                      계획 사이에 비어 있는 시간도
                      <br />
                      여행의 멋진 일부가 될 거예요.
                    </p>
                    <span className="note-drawing" aria-hidden="true">
                      ⌁
                    </span>
                  </div>
                  <div className="mini-summary">
                    <div>
                      <span>저장한 장소</span>
                      <strong>
                        {places.length}
                        <small>곳</small>
                      </strong>
                    </div>
                    <div>
                      <span>준비 완료</span>
                      <strong>
                        {checks.filter((r) => r.data.done).length}
                        <small>/{checks.length}</small>
                      </strong>
                    </div>
                  </div>
                </aside>
              </div>
            )}
            {tab === "places" && (
              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      다음에, 여기 가자 <span>{places.length}</span>
                    </h2>
                    <p>우리의 발길이 닿을 곳을 모아두세요.</p>
                  </div>
                  <button
                    className="primary-button compact"
                    disabled={readOnly}
                    onClick={() => openModal("place")}
                  >
                    <Plus size={17} />
                    장소 저장
                  </button>
                </div>
                <div className="places-layout">
                  <div className="place-list">
                    {places.map((row, i) => (
                      <article
                        className={`place-card ${selectedMapPlace?.id === row.id ? "selected" : ""}`}
                        key={row.id}
                      >
                        <button className="place-main" onClick={() => setMapPlace(row.id)}>
                          <span className="place-number">{String(i + 1).padStart(2, "0")}</span>
                          <div>
                            <span className="category">{str(row.data.category, "장소")}</span>
                            <h3>{str(row.data.name)}</h3>
                            <p>{str(row.data.address, "주소를 아직 추가하지 않았어요")}</p>
                            {row.data.note ? <small>{str(row.data.note)}</small> : null}
                          </div>
                        </button>
                        <div className="place-card-bottom">
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.data.lat != null && row.data.lng != null ? `${row.data.lat},${row.data.lng}` : `${str(row.data.name)} ${str(row.data.address)}`)}`}
                          >
                            Google 지도
                            <ArrowUpRight size={13} />
                          </a>
                          <div className="row-actions">
                            <IconButton
                              label="장소 수정"
                              onClick={() => openModal("place", row)}
                              disabled={readOnly}
                            >
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              label="장소 삭제"
                              onClick={() => {
                                void removeRecord(row);
                              }}
                              disabled={readOnly}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        </div>
                      </article>
                    ))}
                    {!places.length && (
                      <div className="content-empty">
                        <MapPin size={31} />
                        <h3>마음에 드는 곳을 저장해 보세요</h3>
                        <p>맛집, 카페, 숙소… 가보고 싶은 곳이라면 어디든.</p>
                        <button
                          className="outlined-button"
                          disabled={readOnly}
                          onClick={() => openModal("place")}
                        >
                          <Plus size={16} />
                          장소 저장하기
                        </button>
                      </div>
                    )}
                  </div>
                  <MapPanel places={places} selectedPlaceId={selectedMapPlace?.id} />
                </div>
              </section>
            )}
            {tab === "expenses" && (
              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <h2>함께 쓴 여행 경비</h2>
                    <p>결제한 사람과 함께 나눌 사람을 기록해요.</p>
                  </div>
                  <button
                    className="primary-button compact"
                    disabled={readOnly}
                    onClick={() => openModal("expense")}
                  >
                    <Plus size={17} />
                    경비 기록
                  </button>
                </div>
                <div className="expense-summary">
                  <div>
                    <span className="eyebrow">TOTAL TRAVEL SPENDING</span>
                    <h3>
                      {Object.entries(totals).length
                        ? Object.entries(totals).map(([currency, amount]) => (
                            <span key={currency}>
                              {money(amount, currency)}
                              <small>{currency}</small>
                            </span>
                          ))
                        : money(0, activeTrip?.currency || "KRW")}
                    </h3>
                    <p>{expenses.length}건의 기록 · 통화별로 합산하며 환율 변환은 하지 않아요.</p>
                  </div>
                  <span className="expense-summary-icon">
                    <Wallet size={37} strokeWidth={1.2} />
                  </span>
                </div>
                <div className="expense-table">
                  <div className="expense-table-heading">
                    <span>사용 내역</span>
                    <span>결제 / 함께 나누기</span>
                    <span>금액</span>
                  </div>
                  {expenses
                    .sort((a, b) => str(b.data.date).localeCompare(str(a.data.date)))
                    .map((row) => (
                      <article className="expense-row" key={row.id}>
                        <div className="expense-title">
                          <span className="expense-icon">
                            <CreditCard size={19} />
                          </span>
                          <div>
                            <h3>{str(row.data.title)}</h3>
                            <p>
                              {str(row.data.date)} · {str(row.data.category)}
                            </p>
                          </div>
                        </div>
                        <div className="expense-people">
                          <strong>{str(row.data.payer)} 결제</strong>
                          <small>
                            {Array.isArray(row.data.participants)
                              ? row.data.participants.join(", ")
                              : ""}
                          </small>
                          <small>
                            1인{" "}
                            {money(
                              num(row.data.amount) /
                                Math.max(
                                  1,
                                  Array.isArray(row.data.participants)
                                    ? row.data.participants.length
                                    : 1,
                                ),
                              str(row.data.currency, "KRW"),
                            )}
                          </small>
                        </div>
                        <div className="expense-amount">
                          <strong>
                            {money(num(row.data.amount), str(row.data.currency, "KRW"))}
                          </strong>
                          <div className="row-actions">
                            <IconButton
                              label="경비 수정"
                              disabled={readOnly}
                              onClick={() => openModal("expense", row)}
                            >
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              label="경비 삭제"
                              disabled={readOnly}
                              onClick={() => {
                                void removeRecord(row);
                              }}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        </div>
                      </article>
                    ))}
                  {!expenses.length && (
                    <div className="content-empty">
                      <Wallet size={30} />
                      <h3>첫 번째 경비를 기록해 보세요</h3>
                      <p>교통비부터 맛있는 한 끼까지, 함께 기억해요.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {tab === "checklist" && (
              <section className="content-section checklist-section">
                <div className="section-heading">
                  <div>
                    <h2>가볍게 떠나기 위한 준비</h2>
                    <p>잊지 말아야 할 것들, 함께 체크해요.</p>
                  </div>
                  <button
                    className="primary-button compact"
                    disabled={readOnly}
                    onClick={() => openModal("checklist")}
                  >
                    <Plus size={17} />
                    항목 추가
                  </button>
                </div>
                <div className="check-progress">
                  <div>
                    <CheckCheck size={25} />
                    <span>
                      <strong>
                        {checks.filter((r) => r.data.done).length} / {checks.length}
                      </strong>{" "}
                      준비 완료
                    </span>
                    <span>
                      {checks.length
                        ? Math.round(
                            (checks.filter((r) => r.data.done).length / checks.length) * 100,
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${checks.length ? (checks.filter((r) => r.data.done).length / checks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="checklist-list">
                  {checks.map((row) => (
                    <article
                      key={row.id}
                      className={`checklist-row ${row.data.done ? "checked" : ""}`}
                    >
                      <button
                        className="check-toggle"
                        aria-label={`${str(row.data.title)} ${row.data.done ? "완료 취소" : "완료하기"}`}
                        aria-pressed={row.data.done === true}
                        disabled={readOnly}
                        onClick={() => {
                          void mutate(
                            "upsert",
                            "checklist",
                            { ...row.data, done: !row.data.done },
                            row,
                          ).catch((e) => flash(e.message));
                        }}
                      >
                        <span>{row.data.done === true && <Check size={15} />}</span>
                        <strong>{str(row.data.title)}</strong>
                      </button>
                      <span className="category">{str(row.data.category, "준비")}</span>
                      <div className="row-actions">
                        <IconButton
                          label="체크 항목 수정"
                          disabled={readOnly}
                          onClick={() => openModal("checklist", row)}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton
                          label="체크 항목 삭제"
                          disabled={readOnly}
                          onClick={() => {
                            void removeRecord(row);
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </article>
                  ))}
                  {!checks.length && (
                    <div className="content-empty">
                      <ListChecks size={31} />
                      <h3>무엇을 챙기면 좋을까요?</h3>
                      <p>예약 확인과 준비물을 하나씩 적어보세요.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {tab === "members" && (
              <section className="content-section members-section">
                <div className="section-heading">
                  <div>
                    <h2>함께여서 더 좋은 여행</h2>
                    <p>초대받은 친구끼리만 여행을 준비해요.</p>
                  </div>
                </div>
                {mode !== "shared" ? (
                  <div className="collaboration-card">
                    <span className="collaboration-icon">
                      <Users size={35} strokeWidth={1.3} />
                    </span>
                    <span className="eyebrow">PLAN TOGETHER, TRAVEL BETTER</span>
                    <h3>친구와 같은 여행 노트를 펼쳐요.</h3>
                    <p>
                      현재 여행은 이 브라우저에 저장되어 있어요.
                      <br />
                      로그인 후 공유 여행을 만들면 친구를 초대하고 함께 편집할 수 있습니다.
                    </p>
                    {user ? (
                      <button className="primary-button" onClick={() => openModal("trip")}>
                        <Plus size={17} />
                        공유 여행 만들기
                      </button>
                    ) : (
                      <button className="primary-button" onClick={() => setAuthOpen(true)}>
                        <LogIn size={17} />
                        로그인하고 함께 계획하기
                      </button>
                    )}
                    <div className="collab-benefits">
                      <span>
                        <ShieldCheck size={16} />
                        초대 링크로만 참여
                      </span>
                      <span>
                        <Pencil size={16} />
                        편집·보기 권한 선택
                      </span>
                      <span>
                        <Cloud size={16} />
                        온라인에서 자동 갱신
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="members-banner">
                      <div>
                        <Users size={24} />
                        <span>
                          <strong>우리끼리만 보는 여행</strong>
                          <p>편집 내용은 온라인에서 약 8초마다 확인해요.</p>
                        </span>
                      </div>
                      <button
                        className="primary-button compact"
                        disabled={readOnly || activeTrip?.role !== "owner"}
                        onClick={() => openModal("invite")}
                      >
                        <Link2 size={16} />
                        초대 링크 관리
                      </button>
                    </div>
                    <div className="member-list">
                      {(workspace.members as Member[]).map((member, index) => {
                        const m = member as Member & {
                          userId?: string;
                          name?: string;
                          email?: string;
                          role?: string;
                        };
                        return (
                          <div className="member-row" key={m.id || m.userId || index}>
                            <span className="avatar">{(m.name || m.email || "친구")[0]}</span>
                            <div>
                              <strong>{m.name || m.email || "함께하는 친구"}</strong>
                              <small>{m.email}</small>
                            </div>
                            <span className="category">
                              {m.role === "owner"
                                ? "여행 주인"
                                : m.role === "viewer"
                                  ? "보기 가능"
                                  : "편집 가능"}
                            </span>
                            {activeTrip?.role === "owner" && m.role !== "owner" && (
                              <button
                                className="member-remove-button"
                                disabled={saving}
                                onClick={() => {
                                  void removeMember(member);
                                }}
                              >
                                참여 해제
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className="privacy-copy">
                  <ShieldCheck size={18} />
                  <p>
                    여행은 공개되지 않아요. 초대 링크를 받은 사람만 참여할 수 있으며, 초대 링크를
                    해제하면 이후 신규 참여가 차단됩니다.
                  </p>
                </div>
              </section>
            )}
          </main>
        )}
      </div>
      <nav className="mobile-bottom-nav" aria-label="모바일 메뉴">
        <button className={!workspace ? "active" : ""} onClick={() => setWorkspace(null)}>
          <LayoutGrid size={20} />
          <span>나의 여행</span>
        </button>
        {workspace ? (
          <>
            <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
              <CalendarDays size={20} />
              <span>일정</span>
            </button>
            <button className={tab === "places" ? "active" : ""} onClick={() => setTab("places")}>
              <MapPin size={20} />
              <span>장소</span>
            </button>
            <button
              className={tab === "expenses" ? "active" : ""}
              onClick={() => setTab("expenses")}
            >
              <Wallet size={20} />
              <span>경비</span>
            </button>
            <button
              className={tab === "checklist" ? "active" : ""}
              onClick={() => setTab("checklist")}
            >
              <ListChecks size={20} />
              <span>준비</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={() => openModal("trip")}>
              <Plus size={21} />
              <span>새 여행</span>
            </button>
            <button onClick={openSample}>
              <Compass size={21} />
              <span>둘러보기</span>
            </button>
            <button onClick={() => importRef.current?.click()}>
              <ArrowDownToLine size={20} />
              <span>가져오기</span>
            </button>
          </>
        )}
      </nav>
      {joinToken && !authOpen && (
        <Dialog
          title="여행 초대를 받았어요"
          onClose={() => {
            setJoinToken(null);
            history.replaceState(null, "", "/");
          }}
        >
          <div className="invite-intro">
            <Users size={38} />
            <h3>우리의 다음 여행, 함께 준비해요.</h3>
            <p>
              로그인한 계정으로 초대를 수락하면 여행을 볼 수 있어요. 초대받은 권한에 따라 함께
              편집할 수 있습니다.
            </p>
            {user ? (
              <button
                className="primary-button"
                disabled={saving}
                onClick={() => {
                  void joinTrip();
                }}
              >
                {saving && <LoaderCircle size={16} className="spin" />}초대 수락하기
              </button>
            ) : (
              <button onClick={() => setAuthOpen(true)} className="primary-button">
                로그인하고 초대 수락
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </Dialog>
      )}
      {authOpen && (
        <Dialog title="트립부기에 오신 걸 환영해요" onClose={() => setAuthOpen(false)}>
          <AuthPanel
            onAuthenticated={() => {
              void authenticated();
            }}
          />
        </Dialog>
      )}
      {modal && (
        <Dialog title={modalTitle} onClose={closeModal}>
          <form onSubmit={submitForm} className="modal-form">
            {(modal.type === "trip" || modal.type === "settings") && (
              <>
                <p className="form-intro">어디로 떠나고 싶으세요? 우리만의 여정을 시작해요.</p>
                <Field label="여행 이름">
                  <input
                    name="title"
                    required
                    maxLength={120}
                    autoComplete="off"
                    placeholder="예: 우리의 첫 제주 여행"
                    defaultValue={modal.type === "settings" ? activeTrip?.title : ""}
                  />
                </Field>
                <Field label="목적지">
                  <input
                    name="destination"
                    required
                    maxLength={200}
                    placeholder="예: 제주도, 대한민국"
                    defaultValue={modal.type === "settings" ? activeTrip?.destination : ""}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="떠나는 날">
                    <input
                      type="date"
                      name="startDate"
                      required
                      defaultValue={
                        modal.type === "settings"
                          ? activeTrip?.startDate
                          : new Date().toISOString().slice(0, 10)
                      }
                    />
                  </Field>
                  <Field label="돌아오는 날">
                    <input
                      type="date"
                      name="endDate"
                      required
                      defaultValue={
                        modal.type === "settings"
                          ? activeTrip?.endDate
                          : new Date().toISOString().slice(0, 10)
                      }
                    />
                  </Field>
                </div>
                <Field label="기본 통화">
                  <select
                    name="currency"
                    defaultValue={modal.type === "settings" ? activeTrip?.currency : "KRW"}
                  >
                    {[
                      "KRW",
                      "USD",
                      "JPY",
                      "EUR",
                      "GBP",
                      "CNY",
                      "TWD",
                      "THB",
                      "VND",
                      "AUD",
                      "SGD",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                {modal.type === "trip" && (
                  <Field label="여행 저장 방식">
                    <select name="storage" defaultValue={user ? "shared" : "local"}>
                      <option value="local">이 기기에 저장 · 로그인 없이 사용</option>
                      {user && <option value="shared">온라인 공유 · 친구 초대와 함께 편집</option>}
                    </select>
                    <small>
                      기기 저장 여행은 이 브라우저에서만 열 수 있어요. 친구 초대는 온라인 공유
                      여행에서 사용할 수 있습니다.
                    </small>
                  </Field>
                )}
                {modal.type === "settings" && (
                  <button type="button" className="backup-button" onClick={exportTrip}>
                    <ArrowDownToLine size={17} />이 여행 JSON 백업 내보내기
                  </button>
                )}
              </>
            )}
            {modal.type === "plan" && (
              <>
                <Field label="무엇을 할까요?">
                  <input
                    name="title"
                    required
                    maxLength={200}
                    placeholder="예: 바닷가에서 느긋한 아침"
                    defaultValue={str(modalData.title)}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="날짜">
                    <select name="date" defaultValue={str(modalData.date, currentDate)}>
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {dayFormat(d, true)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="시간">
                    <input name="time" type="time" defaultValue={str(modalData.time, "10:00")} />
                  </Field>
                </div>
                <div className="form-grid">
                  <Field label="분류">
                    <select name="category" defaultValue={str(modalData.category, "관광")}>
                      {["관광", "맛집", "카페", "자연", "이동", "숙소", "쇼핑", "기타"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="머무는 시간 (분)">
                    <input
                      name="duration"
                      type="number"
                      min="0"
                      max="1440"
                      placeholder="60"
                      defaultValue={
                        modalData.duration === undefined ? "" : String(modalData.duration)
                      }
                    />
                  </Field>
                </div>
                <Field label="저장한 장소 연결">
                  <select name="placeId" defaultValue={str(modalData.placeId)}>
                    <option value="">장소 연결 안 함</option>
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {str(p.data.name)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="메모">
                  <textarea
                    name="note"
                    rows={3}
                    maxLength={4000}
                    placeholder="함께 기억할 작은 이야기"
                    defaultValue={str(modalData.note)}
                  />
                </Field>
              </>
            )}
            {modal.type === "place" && (
              <>
                <Field label="장소 이름">
                  <input
                    name="name"
                    required
                    maxLength={200}
                    placeholder="예: 함덕해수욕장"
                    defaultValue={str(modalData.name)}
                  />
                </Field>
                <Field label="주소">
                  <input
                    name="address"
                    maxLength={500}
                    placeholder="Google 지도에서 찾은 주소를 적어주세요"
                    defaultValue={str(modalData.address)}
                  />
                </Field>
                <Field label="분류">
                  <select name="category" defaultValue={str(modalData.category, "관광")}>
                    {["관광", "맛집", "카페", "자연", "숙소", "쇼핑", "기타"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="위도 (선택)">
                    <input
                      name="lat"
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      placeholder="33.5432"
                      defaultValue={modalData.lat == null ? "" : String(modalData.lat)}
                    />
                  </Field>
                  <Field label="경도 (선택)">
                    <input
                      name="lng"
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      placeholder="126.6692"
                      defaultValue={modalData.lng == null ? "" : String(modalData.lng)}
                    />
                  </Field>
                </div>
                <p className="field-help">
                  좌표를 입력하면 지도에서 정확한 위치를 확인할 수 있어요. 주소만 입력해도 Google
                  지도 검색이 가능합니다.
                </p>
                <Field label="메모">
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={4000}
                    placeholder="이곳이 마음에 든 이유"
                    defaultValue={str(modalData.note)}
                  />
                </Field>
              </>
            )}
            {modal.type === "expense" && (
              <>
                <Field label="사용 내역">
                  <input
                    name="title"
                    required
                    maxLength={200}
                    placeholder="예: 공항에서 숙소까지 택시"
                    defaultValue={str(modalData.title)}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="금액">
                    <input
                      name="amount"
                      required
                      type="number"
                      min="0.01"
                      max="999999999999"
                      step="0.01"
                      defaultValue={modalData.amount === undefined ? "" : String(modalData.amount)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="통화">
                    <select
                      name="currency"
                      defaultValue={str(modalData.currency, activeTrip?.currency || "KRW")}
                    >
                      {[
                        "KRW",
                        "USD",
                        "JPY",
                        "EUR",
                        "GBP",
                        "CNY",
                        "TWD",
                        "THB",
                        "VND",
                        "AUD",
                        "SGD",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="form-grid">
                  <Field label="사용일">
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={str(modalData.date, currentDate)}
                    />
                  </Field>
                  <Field label="분류">
                    <select name="category" defaultValue={str(modalData.category, "식비")}>
                      {["식비", "교통", "숙소", "관광", "쇼핑", "기타"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="결제한 사람">
                  <input
                    name="payer"
                    required
                    maxLength={100}
                    defaultValue={str(modalData.payer, user?.name || "나")}
                  />
                </Field>
                <Field label="함께 나눌 사람 (쉼표로 구분)">
                  <input
                    name="participants"
                    required
                    maxLength={1000}
                    placeholder="나, 민지, 지훈"
                    defaultValue={
                      Array.isArray(modalData.participants)
                        ? modalData.participants.join(", ")
                        : "나"
                    }
                  />
                  <small>입력한 인원수로 균등하게 나눈 금액을 보여드려요.</small>
                </Field>
              </>
            )}
            {modal.type === "checklist" && (
              <>
                <Field label="챙길 것">
                  <input
                    name="title"
                    required
                    maxLength={200}
                    placeholder="예: 여권 유효기간 확인하기"
                    defaultValue={str(modalData.title)}
                  />
                </Field>
                <Field label="분류">
                  <select name="category" defaultValue={str(modalData.category, "준비")}>
                    {["준비", "예약", "짐 싸기", "확인", "기타"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {modal.type === "invite" && (
              <>
                <p className="form-intro">
                  초대 링크를 친구에게 전달해 주세요. 링크가 있는 로그인 사용자만 여행에 참여할 수
                  있어요.
                </p>
                <Field label="초대할 권한">
                  <select name="role" defaultValue="editor">
                    <option value="editor">함께 편집 · 일정과 경비를 수정할 수 있어요</option>
                    <option value="viewer">보기만 · 여행을 확인할 수 있어요</option>
                  </select>
                </Field>
                {inviteUrl && (
                  <div className="invite-result">
                    <label>
                      새 초대 링크
                      <input readOnly value={inviteUrl} />
                    </label>
                    <button
                      type="button"
                      className="outlined-button compact"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(inviteUrl)
                          .then(() => flash("초대 링크를 복사했습니다."))
                          .catch(() => setFormError("링크를 직접 선택해서 복사해 주세요."));
                      }}
                    >
                      <Copy size={15} />
                      복사
                    </button>
                  </div>
                )}
                {invites.length > 0 && (
                  <div className="invite-list">
                    <h3>활성 초대 링크</h3>
                    {invites.map((invite) => (
                      <div key={invite.id}>
                        <span>
                          {invite.role === "viewer" ? "보기" : "편집"} 권한
                          <small>
                            {new Date(invite.expiresAt).toLocaleDateString("ko-KR")}까지
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void api(`/api/trips/${workspace?.trip.id}/invites`, {
                              method: "DELETE",
                              body: JSON.stringify({ id: invite.id }),
                            })
                              .then(() =>
                                setInvites((old) => old.filter((i) => i.id !== invite.id)),
                              )
                              .catch((e) => setFormError(e.message));
                          }}
                        >
                          링크 해제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
            <div className="form-footer">
              <button
                className="outlined-button"
                type="button"
                onClick={closeModal}
                disabled={saving}
              >
                닫기
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || (readOnly && modal.type !== "trip")}
              >
                {saving ? (
                  <LoaderCircle className="spin" size={17} />
                ) : modal.type === "invite" ? (
                  <Link2 size={17} />
                ) : (
                  <Check size={17} />
                )}
                {saving
                  ? "저장하는 중"
                  : modal.type === "invite"
                    ? "초대 링크 만들기"
                    : modal.type === "trip"
                      ? "여행 시작하기"
                      : "저장하기"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
