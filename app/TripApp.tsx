"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import type {MapPlace} from "./server/maps";
import {tripCountries} from "./trip-destinations";
import { createTravelCityLookup, includesTravelCity } from "./travel-city";
import LaunchScreen from "./components/LaunchScreen";
import TripSidebar from "./components/TripSidebar";
import {
  ConfirmationProvider,
  useConfirm,
  useCancelConfirmation,
} from "./components/Confirmation";
import Toast from "./components/Toast";
import KeyboardFocus from "./components/KeyboardFocus";
import TripGrid from "./components/TripGrid";
import { saveDownload } from "./download";
import { brainImportBatches, exportBrainDocuments, importBrainDocuments } from "./brainstorm-backup";
import { Plus, Users, RefreshCw, LoaderCircle } from "lucide-react";
import type {
  CurrentUser,
  Trip,
  Workspace,
  ItemRecord,
  Profile,
  Bootstrap,
  OverviewChange,
} from "./types";
import {
  apiFetch as api,
  jsonRequest,
  isTemporaryApiError,
  getSupabaseClient,
  signOut,
} from "./client-api";
import AppHeader from "./components/AppHeader";
import NetworkStatus from "./components/NetworkStatus";
import { ProfileState } from "./profile-state";
import InstallPrompt from "./components/InstallPrompt";
import AuthPanel from "./AuthPanel";

import { removeFile, type FileCommand } from "./file-storage";
import { Dialog, CalendarCountry, text } from "./components/ui";
import { SearchLanguage } from "./components/SearchLanguage";
import { profileSearchLanguage } from "./search-language";
import {travelEstimateKey} from "./route-time";
import { comparePlans, itineraryDays,placePoint } from "./planning";
import { WorkspaceMutations } from "./workspace-mutations";
import { WorkspaceCache, reconcileWorkspace } from "./workspace-cache";
import { lazyPanel } from "./components/LazyPanel";
import { isNativeApp } from "./runtime";
import {
  isPreparationTab,
  sectionDestination,
  type TripTab,
  type PreparationTab,
  type MobileSection,
} from "./navigation";
import {
  MobileTripNav,
  PreparationTabs,
  WorkspaceTabs,
} from "./components/TripNavigation";
import TripCollectionControls from "./components/TripCollectionControls";
import PullToRefresh from "./components/PullToRefresh";
import {
  filterTrips,
  preferredTrip,
  initialTripFilter,
  tripSortLabels,
  type TripColumns,
  type TripSort,
  type TripFilter,
} from "./trip-collection";

const AccountSettings = lazyPanel(() => import("./components/AccountSettings"));
const CategorySettings = lazyPanel(() => import("./components/CategorySettings"));
const Members = lazyPanel(() => import("./components/Members"));
const TripPlan = lazyPanel(() => import("./components/TripPlan"));
const TripForm = lazyPanel(() => import("./components/TripForm"));
const PlanComposer = lazyPanel(() => import("./components/PlanComposer"));
const Expenses = lazyPanel(() => import("./components/Expenses"));
const Checklist = lazyPanel(() => import("./components/Checklist"));
const Bookings = lazyPanel(() => import("./components/Bookings"));
const Files = lazyPanel(() => import("./components/Files"));
const Tools = lazyPanel(() => import("./components/Tools"));
const TripSettingsPage = lazyPanel(() => import("./components/TripSettingsPage"));

const emptyRecords: ItemRecord[] = [];
const collectionQuery = "(max-width:960px)";
function subscribeCollectionLayout(notify: () => void) {
  const media = window.matchMedia(collectionQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
const compactCollectionLayout = () =>
  isNativeApp() || window.matchMedia(collectionQuery).matches;
const serverCollectionLayout = () => false;
type Modal = "create" | "trip" | "plan" | "travel-settings" | null;
async function downloadJson(workspace: Workspace, includeCloud = true) {
  const brainstorm = workspace.brainstorm ?? (includeCloud ? await exportBrainDocuments(workspace.trip.id) : []);
  await saveDownload(
    new Blob(
      [
        JSON.stringify(
          {
            format: "tripboogie-v1",
            exportedAt: new Date().toISOString(),
            workspace: { ...workspace, brainstorm },
          }
        ),
      ],
      { type: "application/json" }
    ),
    `${workspace.trip.title}.json`
  );
}
export default function TripApp(props: { initialBootstrap?: Bootstrap } = {}) {
  return (
    <ConfirmationProvider>
      <TripAppContent {...props} />
    </ConfirmationProvider>
  );
}
function TripAppContent({
  initialBootstrap,
}: { initialBootstrap?: Bootstrap } = {}) {
  const confirm = useConfirm(),
    cancelConfirmation = useCancelConfirmation();
  const [user, setUser] = useState<CurrentUser | null>(
      initialBootstrap?.user ?? null
    ),
    [profileState] = useState(
      () => new ProfileState(initialBootstrap?.profile ?? null)
    ),
    [ready, setReady] = useState(!!initialBootstrap),
    [trips, setTrips] = useState<Trip[]>(initialBootstrap?.trips ?? []),
    [atHome, setAtHome] = useState(true),
    [openingTrip, setOpeningTrip] = useState<Trip | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [tab, setTab] = useState<TripTab>("plan"),
    [planView, setPlanView] = useState<"map" | "overview" | "brainstorm">("map"),
    [navigationEpoch, setNavigationEpoch] = useState(0),
    [lastPreparation, setLastPreparation] =
      useState<PreparationTab>("checklist"),
    [accountScreen, setAccountScreen] = useState<"auth" | "profile" | null>(
      initialBootstrap?.profile?.withdrawnAt ? "profile" : null
    ),
    [signingOut, setSigningOut] = useState(false),
    [columns, setColumns] = useState<TripColumns>(3),
    [sort, setSort] = useState<TripSort>("upcoming"),
    [tripFilter, setTripFilter] = useState<TripFilter>({
      ...initialTripFilter,
    }),
    [date, setDate] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [editing, setEditing] = useState<ItemRecord | undefined>(),
    [planBooking,setPlanBooking]=useState<string>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [syncIssue, setSyncIssue] = useState<{tripId:string; userId:string|null} | null>(null),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [bookingFocus, setBookingFocus] = useState(""),
    [expenseFocus,setExpenseFocus]=useState(""),
    [token, setToken] = useState<string | null>(null),
    [legacy, setLegacy] = useState<Workspace[]>([]),
    [listLoading, setListLoading] = useState(false);
  const profile = useSyncExternalStore(
    profileState.subscribe,
    profileState.getSnapshot,
    profileState.getSnapshot
  );
  const setProfile = profileState.receive;
  const accountTheme = profile?.id === user?.id ? profile?.theme : "system";
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        accountTheme === "dark" ||
        ((accountTheme || "system") === "system" && media.matches)
          ? "dark"
          : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [accountTheme]);
  const compactCollection = useSyncExternalStore(
    subscribeCollectionLayout,
    compactCollectionLayout,
    serverCollectionLayout
  );
  const visibleColumns: TripColumns =
    compactCollection && columns === 3 ? 2 : columns;
  const wsRef = useRef(workspace),
    identity = useRef<string | null>(initialBootstrap?.user?.id ?? null),
    bootLoaded = useRef(initialBootstrap?.user?.id ?? null),
    workspaceCache = useRef(new WorkspaceCache(3)),
    workspaceValidator = useRef<{ workspace: Workspace; etag: string } | null>(null),
    refreshInFlight = useRef<{ tripId: string; userId: string | null; result: Promise<boolean> } | null>(null),
    openRequest = useRef(0),
    mutating = useRef(false),
    mutationQueue = useRef<WorkspaceMutations | null>(null),
    importInput = useRef<HTMLInputElement>(null),
    importAttempt = useRef<{ text: string; key: string } | null>(null),
    copyAttempt = useRef<{ sourceId: string; key: string; workspace: Workspace } | null>(null),
    listRequest = useRef(0),
    authRequest = useRef(0);
  const resolveTravelCity = useMemo(() => createTravelCityLookup(async point =>
    (await api<{ places: MapPlace[] }>("/api/maps/reverse", jsonRequest(point))).places[0]
  ), []);
  useEffect(() => {
    wsRef.current = workspace;
  }, [workspace]);
  const changeUser = useCallback(
    (next: CurrentUser | null) => {
      if (identity.current !== (next?.id ?? null)) {
        copyAttempt.current = null;
        importAttempt.current = null;
        cancelConfirmation();
        identity.current = next?.id ?? null;
        workspaceCache.current.clear();
        workspaceValidator.current = null;
        mutationQueue.current = null;
        wsRef.current = null;
        openRequest.current++;
        setOpeningTrip(null);
        setAtHome(true);
        setTrips([]);
        setWorkspace(null);
        setProfile(null);
        setModal(null);
        setAccountScreen(null);
        setError("");
        setSyncIssue(null);
      }
      setUser(next);
    },
    [cancelConfirmation, setProfile]
  );
  const fail = useCallback(
    (e: unknown, id?: string) => {
      const status = (e as { status?: number }).status;
      if (
        (e as { payload?: { code?: string } }).payload?.code ===
        "ACCOUNT_WITHDRAWN"
      ) {
        workspaceCache.current.clear();
        workspaceValidator.current = null;
        setWorkspace(null);
        setTrips([]);
        setModal(null);
        setAccountScreen("profile");
        void api<Profile>("/api/profile")
          .then(setProfile)
          .catch(() => {});
        return;
      }
      setError((e as Error).message || "요청을 완료하지 못했어북");
      if (status === 401) changeUser(null);
      else if (id && (status === 403 || status === 404)) {
        workspaceCache.current.delete(id);
        if (workspaceValidator.current?.workspace.trip.id === id) workspaceValidator.current = null;
        if (wsRef.current?.trip.id === id) {
          wsRef.current = null;
          setWorkspace(null);
          setAtHome(true);
        }
        setTrips((t) => t.filter((x) => x.id !== id));
        setModal(null);
      }
    },
    [changeUser, setProfile]
  );
  const loadList = useCallback(async () => {
    if (!identity.current) return false;
    const n = ++listRequest.current,
      uid = identity.current;
    setListLoading(true);
    try {
      const r = await api<{ trips: Trip[] }>("/api/trips");
      if (n === listRequest.current && uid === identity.current) {
        setTrips(r.trips);
        return true;
      }
      return false;
    } catch (e) {
      if (identity.current === uid) fail(e);
      return false;
    } finally {
      if (n === listRequest.current) setListLoading(false);
    }
  }, [fail]);
  useEffect(() => {
    let active = true;
    const initialRequest = ++authRequest.current;
    if (!initialBootstrap)
      api<Bootstrap>("/api/bootstrap")
        .then((r) => {
          if (!active || authRequest.current !== initialRequest) return;
          bootLoaded.current = r.user?.id ?? null;
          changeUser(r.user);
          setProfile(r.profile);
          setTrips(r.trips);
          if (r.profile?.withdrawnAt) setAccountScreen("profile");
        })
        .catch((e) => {
          if (active) fail(e);
        })
        .finally(() => {
          if (active) setReady(true);
        });
    let dispose: (() => void) | undefined;
    getSupabaseClient()
      .then((client) => {
        if (!active || !client) return;
        const { data } = client.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") {
            authRequest.current++;
            changeUser(null);
          } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")
            setTimeout(() => {
              const request = ++authRequest.current;
              if (active)
                void api<{ user: CurrentUser | null }>("/api/me")
                  .then((r) => {
                    if (active && request === authRequest.current)
                      changeUser(r.user);
                  })
                  .catch(() => {});
            }, 0);
        });
        dispose = () => data.subscription.unsubscribe();
      })
      .catch(() => {});
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = JSON.parse(
          localStorage.getItem("tripboogie.local.v1") || "[]"
        );
        if (Array.isArray(saved))
          setLegacy(
            saved.flatMap((x) =>
              x?.workspace?.trip && Array.isArray(x.workspace.records)
                ? [x.workspace]
                : []
            )
          );
      } catch {}
      for (const key of Object.keys(localStorage))
        if (key.startsWith("tripboogie-cache:")) localStorage.removeItem(key);
      const match = location.pathname.match(/^\/invite\/([0-9a-f]{64})\/?$/);
      if (match) setToken(match[1]);
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [changeUser, fail, initialBootstrap, setProfile]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [accountScreen, workspace?.trip.id, tab, atHome, navigationEpoch]);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    if (bootLoaded.current === userId) {
      bootLoaded.current = null;
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) void loadList();
    });
    api<Profile>("/api/profile")
      .then((p) => {
        if (active && identity.current === userId) {
          setProfile(p);
          if (p.withdrawnAt) {
            setTrips([]);
            setWorkspace(null);
            setAccountScreen("profile");
          }
        }
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [userId, loadList, fail, setProfile]);
  // Account preferences follow the signed-in user across web and native sessions.
  useEffect(() => {
    if (!userId) return;
    let active = true,
      pending = false,
      lastStarted = 0;
    const controller = new AbortController();
    const synchronize = async () => {
      if (
        document.visibilityState !== "visible" ||
        pending ||
        mutating.current ||
        Date.now() - lastStarted < 500
      )
        return;
      pending = true;
      lastStarted = Date.now();
      try {
        const next = await api<Profile>(
          "/api/profile",
          { signal: controller.signal },
          { background: true }
        );
        if (!active || identity.current !== userId || next.id !== userId)
          return;
        setProfile(next);
        if (next.withdrawnAt) {
          setWorkspace(null);
          setTrips([]);
          setAccountScreen("profile");
        }
      } catch (error) {
        if (
          active &&
          identity.current === userId &&
          (error as { status?: number }).status === 401
        )
          fail(error);
      } finally {
        pending = false;
      }
    };
    window.addEventListener("focus", synchronize);
    window.addEventListener("tripboogie:foreground", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", synchronize);
      window.removeEventListener("tripboogie:foreground", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, [userId, fail, setProfile]);
  function accept(next: Workspace) {
    const accepted = reconcileWorkspace(wsRef.current, next);
    if (workspaceValidator.current?.workspace !== accepted) workspaceValidator.current = null;
    workspaceCache.current.set(accepted.trip.id, accepted);
    wsRef.current = accepted;
    setWorkspace(accepted);
    setTrips((t) => [accepted.trip, ...t.filter((x) => x.id !== accepted.trip.id)]);
  }
  const refresh = useCallback(
    async (background = false) => {
      const current = wsRef.current,
        uid = identity.current;
      if (!current) return false;
      const pending = refreshInFlight.current;
      if (pending?.tripId === current.trip.id && pending.userId === uid)
        return pending.result;
      const result = (async () => {
        try {
          let etag: string | null = null;
          const next = await api<Workspace>(
            `/api/trips/${current.trip.id}`,
            {},
            { background, conditional: {
              etag: workspaceValidator.current?.workspace === current ? workspaceValidator.current.etag : undefined,
              receiveEtag: value => { etag = value; },
            } }
          );
          if (!next) {
            const sameTrip = identity.current === uid && wsRef.current?.trip.id === current.trip.id;
            if (sameTrip) setSyncIssue(null);
            return sameTrip;
          }
          if (
            identity.current === uid &&
            wsRef.current?.trip.id === next.trip.id &&
            !mutating.current
          ) {
            setSyncIssue(null);
            setWorkspace((w) => {
              if (w && next.revision >= w.revision) {
                const accepted = reconcileWorkspace(w, next);
                workspaceValidator.current = etag ? { workspace: accepted, etag } : null;
                workspaceCache.current.set(accepted.trip.id, accepted);
                wsRef.current = accepted;
                return accepted;
              }
              return w;
            });
            return true;
          }
          return false;
        } catch (e) {
          if (identity.current === uid && wsRef.current?.trip.id === current.trip.id) {
            if (background && isTemporaryApiError(e)) {
              setSyncIssue(previous => previous?.tripId === current.trip.id && previous.userId === uid ? previous : {tripId:current.trip.id,userId:uid});
            } else fail(e, current.trip.id);
          }
          return false;
        }
      })();
      refreshInFlight.current = { tripId: current.trip.id, userId: uid, result };
      try {
        return await result;
      } finally {
        if (refreshInFlight.current?.result === result) refreshInFlight.current = null;
      }
    },
    [fail]
  );
  const refreshScreen = useCallback(async () => {
    // Refresh the data in place on every platform. Reloading the document
    // destroys the visible screen and paints LaunchScreen before auth is ready.
    if (accountScreen || !userId) {
      const request = ++authRequest.current,
        uid = identity.current;
      try {
        const next = await api<Bootstrap>("/api/bootstrap");
        if (request !== authRequest.current || uid !== identity.current) return;
        changeUser(next.user);
        setProfile(next.profile);
        setTrips(next.trips);
        if (next.profile?.withdrawnAt) setAccountScreen("profile");
      } catch (e) {
        if (request === authRequest.current && uid === identity.current) fail(e);
      }
      return;
    }
    const refreshed =
      !atHome && wsRef.current ? await refresh() : await loadList();
    if (refreshed) setNotice("최신 내용을 불러왔어북");
  }, [refresh, loadList, atHome, accountScreen, userId, changeUser, setProfile, fail]);
  useEffect(() => {
    if (!workspace?.trip.id || atHome || modal || busy) return;
    const synchronize = () => {
      if (document.visibilityState === "visible" && !mutating.current)
        void refresh(true);
    };
    const timer = setInterval(synchronize, tab === "plan" && planView === "overview" ? 3000 : 8000);
    window.addEventListener("online", synchronize);
    window.addEventListener("focus", synchronize);
    window.addEventListener("tripboogie:foreground", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", synchronize);
      window.removeEventListener("focus", synchronize);
      window.removeEventListener("tripboogie:foreground", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, [workspace?.trip.id, atHome, modal, busy, refresh, tab, planView]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timer);
  }, [notice]);
  async function run<T>(
    path: string,
    payload: unknown,
    method = "POST",
    queued = false,
    blocking = true
  ): Promise<T> {
    if (!queued && mutating.current) throw new Error("앞선 변경을 저장하는 중이야북");
    if (!queued) mutating.current = true;
    if (blocking) setBusy(true);
    if (!queued) setError("");
    const uid = identity.current;
    try {
      const result = await api<T>(path, jsonRequest(payload, { method }));
      if (identity.current !== uid)
        throw new Error("계정이 바뀌었습니다. 다시 열어 주세요.");
      return result;
    } catch (e) {
      if ((e as { status?: number }).status === 409)
        setError(
          "다른 변경이 먼저 저장되었어요. 최신 내용을 불러온 후 다시 시도해 주세요."
        );
      if (identity.current === uid) fail(e, wsRef.current?.trip.id);
      throw e;
    } finally {
      if (!queued) mutating.current = false;
      if (blocking) setBusy(false);
    }
  }
  function commit(payload: Record<string, unknown>, operation?: string, project?: (current: Workspace) => Workspace) {
    const current = wsRef.current;
    if (!current) throw new Error("여행을 먼저 열어 줘북");
    const uid = identity.current;
    const mayRebaseVersion = payload.version === undefined || payload.version === current.records.find((r) => r.id === payload.id)?.version;
    if (!mutationQueue.current?.size) {
      if (mutating.current) throw new Error("앞선 변경을 저장하는 중이야북");
      setError("");
      mutationQueue.current = new WorkspaceMutations(current, (next) => {
        if (identity.current !== uid || wsRef.current?.trip.id !== next.trip.id) return;
        workspaceCache.current.set(next.trip.id, next);
        if (wsRef.current?.trip.id === next.trip.id) accept(next);
      }, (count) => { if (identity.current === uid) mutating.current = count > 0; });
    }
    return mutationQueue.current.enqueue(project ?? ((w) => w), async (confirmed) => {
      if (identity.current !== uid) throw new Error("계정이 바뀌었습니다. 다시 열어 주세요.");
      const latest = confirmed.records.find((r) => r.id === payload.id);
      const rebased = { ...payload, ...(latest && mayRebaseVersion ? { version: latest.version } : {}),
        ...(["update-settings", "reorder-checklist"].includes(operation || "") ? { revision: confirmed.revision } : {}) };
      return run<Workspace>(`/api/trips/${current.trip.id}${operation === "schedule" ? "/schedule" : operation ? `/actions/${operation}` : ""}`,
        operation === "schedule" ? { ...rebased, revision: confirmed.revision } : rebased,
        "POST", true, !project);
    });
  }
  async function suggestTravelCity(place:MapPlace,start:string,end=start){
    const original=wsRef.current;if(!original)return;
    if(place.countryCode!=="CN"&&place.cityName&&await includesTravelCity({...place,name:place.cityName},original.trip.settings.cities||[],resolveTravelCity))return;
    let candidate:MapPlace|undefined;
    try{candidate=await resolveTravelCity(place);}catch{return;}
    if(!candidate?.countryCode||!candidate.timezone)return;
    const current=wsRef.current;if(!current||current.trip.id!==original.trip.id)throw new Error("여행이 바뀌었어요. 다시 저장해 주세요.");
    const cityName=candidate.cityName||candidate.name,cities=current.trip.settings.cities||[];
    try{if(await includesTravelCity(candidate,cities,resolveTravelCity))return;}catch{return;}
    if(wsRef.current?.trip.id!==current.trip.id)throw new Error("여행이 바뀌었어요. 다시 저장해 주세요.");
    if(cities.length>=20){setNotice("방문 도시는 최대 20개까지 추가할 수 있어요.");return;}
    if(!(await confirm(`${cityName}을(를) 여행 방문 도시에 추가할까요?`,{title:"방문 도시 추가",confirmLabel:"추가하기",intent:"default"})))return;
    if(wsRef.current?.trip.id!==current.trip.id)throw new Error("여행이 바뀌었어요. 다시 저장해 주세요.");
    const latest=wsRef.current,from=start<latest.trip.startDate?latest.trip.startDate:start>latest.trip.endDate?latest.trip.endDate:start,to=end<from?from:end>latest.trip.endDate?latest.trip.endDate:end;
    await commit({cities:[...(latest.trip.settings.cities||[]),{...candidate,name:cityName,id:crypto.randomUUID(),startDate:from,endDate:to}],countries:[...new Set([...tripCountries(latest.trip),candidate.countryCode])]},"update-settings");
  }
  function previewSave(kind: ItemRecord["kind"], data: Record<string, unknown>, id: string) {
    return (current: Workspace): Workspace => {
      const existing = current.records.find((r) => r.id === id);
      const record: ItemRecord = { id, kind, version: 1, updatedAt: new Date().toISOString(), updatedBy: userId || "", createdBy: userId || "", createdName: user?.name, ...existing, data: { ...existing?.data, ...data } };
      if(kind==="plan"&&record.data.bookingId&&existing?.data.title!==data.title){record.data.bookingOverrides=[...new Set([...(Array.isArray(existing?.data.bookingOverrides)?existing.data.bookingOverrides:[]),"title"])];}
      const records=existing?current.records.map(r=>r.id===id?record:r):[...current.records,record];
      const bookingId=kind==="booking"?id:kind==="plan"?record.data.bookingId:undefined;
      return {...current,records:bookingId&&Object.hasOwn(data,"note")?records.map(r=>(r.id===bookingId&&r.kind==="booking"||r.kind==="plan"&&r.data.bookingId===bookingId)?{...r,data:{...r.data,note:data.note}}:r):records};
    };
  }
  async function save(
    kind: ItemRecord["kind"],
    data: Record<string, unknown>,
    record?: ItemRecord
  ) {
    const id = record?.id ?? crypto.randomUUID();
    void commit({
      action: "upsert",
      kind,
      data,
      id,
      version: record?.version,
    }, undefined, previewSave(kind, data, id)).then(() => setNotice("저장했어북")).catch(() => {});
  }
  async function remove(record: ItemRecord) {
    if (
      !(await confirm(
        record.kind==="plan"&&record.data.entryType==="memo"?"메모를 삭제할까요?":`“${text(
          record.data.title,
          text(record.data.name)
        )}” 항목을 삭제할까북?${
          record.kind === "booking"
            ? " 첨부파일은 예약에, 결제 경비는 경비 목록에 남아북"
            : ""
        }`
      ))
    )
      return;
    try {
      void commit({
        action: "delete",
        kind: record.kind,
        id: record.id,
        version: record.version,
      }, undefined, (w) => ({ ...w, records: w.records.filter((r) => r.id !== record.id && !(record.kind === "booking" && r.kind === "plan" && r.data.bookingId === record.id && r.data.bookingManaged === true)) }))
        .then(() => setNotice("삭제했어북")).catch(() => {});
    } catch {}
  }
  async function settings(data: Record<string, unknown>) {
    await commit(
      { ...data, revision: wsRef.current!.revision },
      "update-settings"
    );
  }
  const fileCommand: FileCommand = async (op, payload) => {
    const tripId = workspace?.trip.id;
    if (!tripId || wsRef.current?.trip.id !== tripId)
      throw new Error("여행이 바뀌었어북. 자료함에서 다시 확인해북.");
    const result = await run<Awaited<ReturnType<FileCommand>>>(
      `/api/trips/${tripId}/actions/${op}`,
      payload
    );
    if (wsRef.current?.trip.id === tripId) accept(result.workspace);
    return result;
  };
  async function open(trip: Trip, destination: TripTab = "plan") {
    if (mutating.current) {
      setNotice("저장 중이야북");
      return;
    }
    const request = ++openRequest.current,
      uid = identity.current,
      cached = workspaceCache.current.get(trip.id);
    setError("");
    setAccountScreen(null);
    setDate(trip.startDate);
    setTab(destination);
    setBookingFocus("");
    setExpenseFocus("");
    setSelected("");
    setModal(null);
    setAtHome(false);
    if (cached) {
      accept(cached);
      setOpeningTrip(null);
    } else {
      wsRef.current = null;
      setWorkspace(null);
      setOpeningTrip(trip);
    }
    try {
      const next = await api<Workspace>(`/api/trips/${trip.id}`);
      if (
        uid === identity.current &&
        request === openRequest.current &&
        !mutating.current
      ) {
        accept(next);
        setAtHome(false);
      }
    } catch (e) {
      if (uid === identity.current && request === openRequest.current) {
        fail(e, trip.id);
        if (!cached) setAtHome(true);
      }
    } finally {
      if (request === openRequest.current) setOpeningTrip(null);
    }
  }
  async function optimistic(
    operation: string,
    payload: Record<string, unknown>,
    project: (current: Workspace) => Workspace
  ) {
    return commit(payload, operation, project);
  }
  async function schedule(data: Record<string, unknown>) {
    const ids = Array.isArray(data.ids) ? data.ids as string[] : [];
    return commit(data, "schedule", (current) => ({
      ...current,
      records: current.records.filter((r) => !(data.operation === "delete" && ids.includes(r.id)))
        .map((r) => {
          if (r.kind !== "plan") return r;
          if (data.operation === "reorder" && r.data.date === data.sourceDate && ids.includes(r.id))
            return { ...r, data: { ...r.data, position: ids.indexOf(r.id) } };
          if (data.operation === "move" && ids.includes(r.id))
            return { ...r, data: { ...r.data, date: data.targetDate } };
          if (data.operation === "swap-days") {
            const date = r.data.date === data.sourceDate ? data.targetDate : r.data.date === data.targetDate ? data.sourceDate : r.data.date;
            return { ...r, data: { ...r.data, date } };
          }
          return r;
        }),
    }));
  }
  async function importWorkspace(source: Workspace, key: string) {
    if (source.brainstorm && (!Array.isArray(source.brainstorm) || source.brainstorm.length > 30)) throw new Error("브레인스토밍 문서는 최대 30개까지 가져올 수 있어요.");
    source.brainstorm?.forEach(brainImportBatches);
    const next = await run<Workspace>("/api/trips/import", {
      key,
      trip: source.trip,
      records: source.records.map(({ id, kind, data }) => ({ id, kind, data })),
      ...(source.overview ? { overview: source.overview } : {}),
    });
    if (source.brainstorm?.length) {
      setBusy(true);
      try { await importBrainDocuments(next.trip.id, source.brainstorm, key); }
      catch { throw new Error("문서 복원이 중단됐어요. 같은 가져오기·복사를 다시 시도하면 이어서 복원합니다. 생성된 여행은 보존됐어요."); }
      finally { setBusy(false); }
    }
    accept(next);
    setAtHome(false);
    setDate(next.trip.startDate);
    setTab("plan");
    setAccountScreen(null);
    return next;
  }
  async function importJson(file: File) {
    if (!user) {
      setAccountScreen("auth");
      return;
    }
    try {
      if (file.size > 25165824)
        throw new Error("24 MiB 이하의 JSON 백업을 선택하세요.");
      const content = await file.text(),
        data = JSON.parse(content);
      if (
        data.format !== "tripboogie-v1" ||
        !data.workspace?.trip ||
        !Array.isArray(data.workspace.records)
      )
        throw new Error("트립부기 JSON 백업을 선택하세요.");
      if (importAttempt.current?.text !== content)
        importAttempt.current = { text: content, key: crypto.randomUUID() };
      await importWorkspace(data.workspace, importAttempt.current!.key);
      importAttempt.current = null;
      setNotice(
        "새 여행으로 가져왔어북. 동행과 첨부파일 원본은 포함되지 않아북"
      );
    } catch (e) {
      fail(e);
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  }
  async function migrate(source: Workspace) {
    if (!user) {
      setAccountScreen("auth");
      return;
    }
    try {
      const hash = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`${location.origin}:${source.trip.id}`)
        )
      );
      hash[6] = (hash[6] & 15) | 64;
      hash[8] = (hash[8] & 63) | 128;
      const h = Array.from(hash.slice(0, 16), (b) =>
          b.toString(16).padStart(2, "0")
        ).join(""),
        key = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
          16,
          20
        )}-${h.slice(20)}`;
      await importWorkspace(source, key);
      setLegacy((rows) => rows.filter((t) => t.trip.id !== source.trip.id));
      setNotice("기기 여행을 서버로 가져왔어북. 기기 원본은 보존했어북");
    } catch (e) {
      fail(e);
    }
  }
  const activeTripId = workspace?.trip.id;
  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    let remove: (() => Promise<void>) | undefined;
    void import("@capacitor/app")
      .then(async ({ App }) => {
        if (!active) return;
        const listener = await App.addListener(
          "backButton",
          ({ canGoBack }) => {
            if (busy) return;
            const focusedDialog =
              document.activeElement?.closest("dialog[open]");
            const dialogs = document.querySelectorAll("dialog[open]");
            const dialog = focusedDialog || dialogs.item(dialogs.length - 1);
            if (dialog) {
              dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
              return;
            }
            const back = new Event("tripboogie:back", { cancelable: true });
            window.dispatchEvent(back);
            if (back.defaultPrevented) return;
            if (accountScreen) setAccountScreen(null);
            else if (activeTripId && !atHome) {
              if (tab !== "plan") setTab("plan");
              else {
                setAtHome(true);
                setError("");
              }
              window.scrollTo({ top: 0 });
            } else if (canGoBack) history.back();
            else void App.exitApp();
          }
        );
        if (active) remove = () => listener.remove();
        else await listener.remove();
      })
      .catch(() => {});
    return () => {
      active = false;
      void remove?.();
    };
  }, [accountScreen, activeTripId, tab, busy, atHome]);
  const records = workspace?.records ?? emptyRecords;
  const startDate = workspace?.trip.startDate, endDate = workspace?.trip.endDate;
  const allDays = useMemo(() => startDate && endDate ? itineraryDays({startDate, endDate}, records) : [], [startDate, endDate, records]);
  const currentDate = allDays.includes(date) ? date : allDays[0] ?? "",
    plans = useMemo(() => records
      .filter((r) => r.kind === "plan" && r.data.date === currentDate)
      .sort(comparePlans), [records, currentDate]),
    places = useMemo(() => records.filter((r) => r.kind === "place"), [records]),
    readOnly = workspace?.trip.role === "viewer" || busy;
  const myProfile = profile;
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  });
  const selectedTrip =
    openingTrip ?? workspace?.trip ?? (compactCollection ? null : preferredTrip(trips, today));
  const visibleTrips = useMemo(() => filterTrips(trips, search, tripFilter, sort, today), [trips, search, tripFilter, sort, today]);
  async function withdrawAccount() {
    await api(
      "/api/account",
      jsonRequest({ confirmation: "탈퇴" }, { method: "DELETE" })
    );
    try {
      await signOut();
    } catch {
      try {
        await (await getSupabaseClient())?.auth.signOut({ scope: "local" });
      } catch {}
    } finally {
      changeUser(null);
      setAccountScreen("profile");
      setNotice("탈퇴했어북");
    }
  }
  async function restoreAccount() {
    await api("/api/account", jsonRequest({ confirmation: "복구" }));
    const data = await api<Bootstrap>("/api/bootstrap");
    setProfile(data.profile);
    setTrips(data.trips);
    setAccountScreen("profile");
    setNotice("다시 만나서 반가워북");
  }
  function finishAuthentication() {
    void api<{ user: CurrentUser | null }>("/api/me")
      .then((r) => {
        changeUser(r.user);
        setAccountScreen("profile");
      })
      .catch(fail);
  }
  function resetSurface(next?: TripTab) {
    cancelConfirmation();
    setModal(null);
    setEditing(undefined);
    setSelected("");
    setNavigationEpoch((value) => value + 1);
    if (next === "plan") {
      setPlanView("map");
      if (workspace) setDate(workspace.trip.startDate);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function goHome() {
    if (profile?.withdrawnAt) {
      setAccountScreen("profile");
      setNotice("계정을 먼저 복구해북");
      return;
    }
    resetSurface();
    openRequest.current++;
    setOpeningTrip(null);
    setAtHome(true);
    setAccountScreen(null);
    setError("");
    setModal(null);
  }
  function goTab(next: TripTab, focusedBooking = "") {
    if (profile?.withdrawnAt) {
      setAccountScreen("profile");
      setNotice("계정을 먼저 복구해북");
      return;
    }
    setBookingFocus(next === "bookings" ? focusedBooking : "");
    setExpenseFocus(next === "expenses"?focusedBooking:"");
    if ((!atHome && !accountScreen && tab === next) || next === "settings")
      resetSurface(next);
    if (next === "settings") {
      openRequest.current++;
      setOpeningTrip(null);
      setAccountScreen("profile");
      setModal(null);
      return;
    }
    if (isPreparationTab(next)) setLastPreparation(next);
    if (openingTrip) {
      setTab(next);
      setSelected("");
      return;
    }
    if (!workspace) {
      if (selectedTrip) void open(selectedTrip, next);
      else setNotice("여행을 먼저 골라봐북");
      return;
    }
    setAtHome(false);
    setAccountScreen(null);
    setTab(next);
    setSelected("");
  }
  function goSection(section: MobileSection) {
    const next = sectionDestination(
      section,
      lastPreparation,
      section === "prepare" &&
        !atHome &&
        !accountScreen &&
        isPreparationTab(tab)
    );
    if (next) goTab(next);
    else goHome();
  }
  async function logout() {
    setSigningOut(true);
    try {
      await signOut();
      changeUser(null);
      setAccountScreen(null);
    } catch (e) {
      fail(e);
    } finally {
      setSigningOut(false);
    }
  }
  function backup() {
    if (workspace)
      void downloadJson(workspace)
        .then(() =>
          setNotice("JSON 백업을 받았어북. 첨부파일 원본은 예약에서 내려받아북")
        )
        .catch(fail);
  }
  if (!ready) return <LaunchScreen />;
  return (
    <SearchLanguage.Provider value={profileSearchLanguage(profile)}>
      <CalendarCountry.Provider value={profile?.holidayCountry || ""}>
        <KeyboardFocus />
        <div
          className={`app-shell with-trip-nav ${
            (workspace || openingTrip) && !atHome && !accountScreen ? "in-trip" : ""
          } ${atHome && !accountScreen ? "is-home" : ""} ${accountScreen ? "is-settings" : ""} ${
            accountScreen && !user ? "guest-settings-screen" : ""
          }`}
        >
          <TripSidebar
            selectedTrip={selectedTrip}
            activeTab={!atHome && !accountScreen ? tab : null}
            home={atHome && !accountScreen}
            settings={!!accountScreen}
            onHome={goHome}
            onTab={goTab}
            install={<InstallPrompt />}
          />
          <main className="main">
            <AppHeader
              trip={
                !atHome && !accountScreen ? openingTrip ?? workspace?.trip ?? null : null
              }
              tab={
                accountScreen ? "settings" : atHome ? "home" : tab
              }
              guestSettings={!!accountScreen && !user}
              disabled={busy || !!openingTrip}
              onHome={goHome}
              onTrip={() => setModal("travel-settings")}
            />
            {error && (
              <div className="global-error" role="alert">
                <span>{error}</span>
                <button
                  onClick={() => {
                    setError("");
                    if (workspace) void refresh();
                    else void loadList();
                  }}
                >
                  <RefreshCw size={17} />
                  다시 불러오기
                </button>
                <button
                  className="icon"
                  aria-label="오류 닫기"
                  onClick={() => setError("")}
                >
                  ×
                </button>
              </div>
            )}
            {!error && !atHome && !accountScreen && syncIssue && syncIssue.tripId === workspace?.trip.id && syncIssue.userId === userId && (
              <div className="global-error" role="status">
                <span>연결이 불안정해요. 연결되면 자동으로 다시 동기화해요.</span>
                <button onClick={() => void refresh(true)}><RefreshCw size={17}/>다시 연결</button>
              </div>
            )}
            <PullToRefresh
              enabled={ready && !busy && !modal}
              onRefresh={refreshScreen}
            >
              {accountScreen ? (
                <section className="account-page" key={navigationEpoch}>
                  <AccountSettings
                    onWithdraw={withdrawAccount}
                    onRestore={restoreAccount}
                    provider={user?.provider}
                    profile={accountScreen === "auth" ? null : myProfile}
                    onSave={async (data) => {
                      await profileState.save(data, (payload) =>
                        run<Profile>("/api/profile", payload)
                      );
                      setNotice("저장했어북");
                    }}
                    onLogout={() => void logout()}
                    signingOut={signingOut}
                    onAuthenticated={finishAuthentication}
                  />
                  {user && accountScreen === "profile" && legacy.length > 0 && (
                    <section className="legacy-panel">
                      <h3>이 기기에 남아 있는 이전 여행</h3>
                      <p>기존 여행을 서버로 가져올 수 있어북</p>
                      {legacy.map((w) => (
                        <div className="inline" key={w.trip.id}>
                          <strong>{w.trip.title}</strong>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => void migrate(w)}
                          >
                            서버로 가져오기
                          </button>
                          <button
                            onClick={() => void downloadJson(w, false).catch(fail)}
                          >
                            JSON 백업
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                </section>
              ) : openingTrip ? (
                <div className="workspace" key={navigationEpoch}>
                  <WorkspaceTabs tab={tab} disabled={false} onSelect={goTab}/>
                  <PreparationTabs tab={tab} disabled={false} onSelect={goTab}/>
                  <div className="workspace-loading" role="status" aria-live="polite"><LoaderCircle size={30} className="spinner" aria-hidden="true"/><span>{openingTrip.title} 불러오는 중</span></div>
                </div>
              ) : atHome || !workspace ? (
                <div className="home" key={navigationEpoch}>
                  <section className="home-hero">
                    <div>
                      <h1>다음 여행을 함께 그려북</h1>
                      <p>가고 싶은 곳을 모으고 친구와 일정을 채워북</p>
                      <button
                        className="primary large"
                        onClick={() =>
                          user ? setModal("create") : setAccountScreen("auth")
                        }
                      >
                        <Plus size={21} />새 여행 만들기
                      </button>
                    </div>
                    <div className="hero-art">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <span className="hero-spark">✦</span>
                      <Image
                        unoptimized
                        src="/map-mascot.png"
                        width={1297}
                        height={1213}
                        alt="지도를 펼쳐 든 거북이 부기"
                        priority
                      />
                    </div>
                  </section>
                  <section className="trip-section">
                    <div className="section-heading collection-heading">
                      <div>
                        <h2>
                          나의 여행 노트{" "}
                          <span className="count">
                            {user ? visibleTrips.length : 0}
                          </span>
                        </h2>
                      </div>
                      <button
                        aria-label="새 여행 만들기"
                        className="primary collection-create"
                        onClick={() =>
                          user ? setModal("create") : setAccountScreen("auth")
                        }
                      >
                        <Plus size={19} />
                        <span>새 여행</span>
                      </button>
                    </div>
                    <TripCollectionControls
                      query={search}
                      onQuery={setSearch}
                      columns={visibleColumns}
                      maximumColumns={compactCollection ? 2 : 3}
                      onColumns={setColumns}
                      sort={sort}
                      onSort={(value) => {
                        setSort(value);
                        setNotice(tripSortLabels[value]);
                      }}
                      filter={tripFilter}
                      onFilter={setTripFilter}
                      destinations={[
                        ...new Set(trips.map((t) => t.destination)),
                      ].sort((a, b) => a.localeCompare(b, "ko"))}
                    />
                    {!(listLoading && trips.length === 0) && (
                      <TripGrid
                        groupByStatus={sort === "upcoming"}
                        trips={visibleTrips}
                        today={today}
                        columns={visibleColumns}
                        disabled={busy}
                        onOpen={(t) => void open(t)}
                        hasTrips={trips.length > 0}
                        showEmpty={!!user}
                        onReset={() => {
                          setSearch("");
                          setTripFilter({ ...initialTripFilter });
                        }}
                      />
                    )}
                    {!user && (
                      <div className="welcome-note">
                        <Users size={23} />
                        <span>로그인하고 함께 여행을 준비해북</span>
                      </div>
                    )}
                  </section>
                  <footer>
                    <span>트립부기 © 2026</span>
                  </footer>
                </div>
              ) : (
                <div className="workspace" key={navigationEpoch}>
                  <WorkspaceTabs tab={tab} disabled={busy} onSelect={goTab} />
                  <PreparationTabs tab={tab} disabled={busy} onSelect={goTab} />
                  {tab === "plan" && (
                    <>
                      <TripPlan
                        accountId={user?.id ?? ""}
                        view={planView}
                        onViewChange={setPlanView}
                        onSaveOverview={async (rows: OverviewChange[]) => {
                          try { await commit({rows}, "save-overview", current => current); }
                          catch (cause) { if ((cause as {status?:number}).status === 409) await refresh(true); throw cause; }
                        }}
                        mapHeightScale={myProfile?.mapHeightScale}
                        onMapHeight={myProfile ? async (mapHeightScale) => {
                          if (profileState.getSnapshot()?.id !== myProfile.id) throw new Error("계정이 바뀌었습니다.");
                          await profileState.save({mapHeightScale}, payload=>api<Profile>("/api/profile",jsonRequest(payload)));
                        } : undefined}
                        onBooking={(id) => goTab("bookings", id)}
                        workspace={workspace}
                        date={currentDate}
                        days={allDays}
                        plans={plans}
                        places={places}
                        disabled={readOnly}
                        selected={selected}
                        onSelected={setSelected}
                        onDate={setDate}
                        onSchedule={schedule}
                        onEdit={(r) => {
                          setPlanBooking(undefined);
                          setEditing(r);
                          setModal("plan");
                        }}
                        onRemove={(r) => void remove(r)}
                        onAdd={() => {
                          setPlanBooking(undefined);
                          setEditing(undefined);
                          setModal("plan");
                        }}
                        onError={setError}
                        onSave={(r, data) => save("plan", data, r)}
                        onEstimate={async(plan,fromId,key,mode,minutes)=>{
                          await commit({id:plan.id,fromId,key,mode,minutes},"save-travel-time",current=>{
                            const target=current.records.find(r=>r.id===plan.id),source=current.records.find(r=>r.id===fromId);
                            const a=placePoint(current.records.find(r=>r.id===source?.data.placeId)),b=placePoint(current.records.find(r=>r.id===target?.data.placeId));
                            if(!target||!source||!a||!b||travelEstimateKey(mode,fromId,plan.id,a,b)!==key||text(target.data.transportMode,"walk")!==mode||target.data.travelMinutes!==undefined&&target.data.travelFromId===fromId&&target.data.travelTimeSource!=="estimate")return current;
                            return {...current,records:current.records.map(r=>r.id===plan.id?{...r,data:{...r.data,travelMinutes:minutes,travelFromId:fromId,travelEstimateKey:key,travelTimeSource:"estimate"}}:r)};
                          });
                        }}
                      />
                    </>
                  )}
                  {(tab === "expenses" ||
                    tab === "tools" ||
                    tab === "bookings") &&
                    !myProfile && (
                      <p className="info">
                        프로필의 기준 통화를 확인하는 중이에요. 잠시 후 다시
                        열어 주세요.
                      </p>
                    )}
                  {tab === "expenses" && myProfile && (
                    <Expenses
                      key={`${workspace.trip.id}:${expenseFocus}`}
                      focused={expenseFocus}
                      onBooking={id=>goTab("bookings",id)}
                      workspace={workspace}
                      profile={myProfile}
                      date={currentDate}
                      readOnly={readOnly}
                      onSave={async(d,r)=>{const id=r?.id||crypto.randomUUID();await commit({id,version:r?.version,data:d},"save-expense",previewSave("expense",d,id));setNotice("저장했어북");}}
                      onDelete={(r) => void remove(r)}
                    />
                  )}
                  {tab === "checklist" && user && (
                    <Checklist
                      onReorder={async (category, ids) => {
                        await optimistic("reorder-checklist", { category, ids, revision: workspace.revision }, (w) => ({ ...w, records: w.records.map(r => r.kind === "checklist" && ids.includes(r.id) ? { ...r, data: { ...r.data, position: ids.indexOf(r.id) } } : r) }));
                      }}
                      workspace={workspace}
                      userId={user.id}
                      readOnly={readOnly}
                      onSave={(d, r) => save("checklist", d, r)}
                      onDelete={(r) => void remove(r)}
                      onToggle={async (r, done) => {
                        await optimistic(
                          "checklist-toggle",
                          { id: r.id, done },
                          (current) => ({
                            ...current,
                            records: current.records.map((row) =>
                              row.id !== r.id
                                ? row
                                : {
                                    ...row,
                                    data:
                                      row.data.scope === "all"
                                        ? {
                                            ...row.data,
                                            checks: {
                                              ...((row.data.checks as Record<
                                                string,
                                                string
                                              >) ?? {}),
                                              [user.id]: done
                                                ? new Date().toISOString()
                                                : "",
                                            },
                                          }
                                        : { ...row.data, done },
                                  }
                            ),
                          })
                        );
                      }}
                    />
                  )}
                  {tab === "files" && (
                    <Files
                      key={workspace.trip.id}
                      workspace={workspace}
                      readOnly={readOnly}
                      command={fileCommand}
                    />
                  )}
                  {tab === "bookings" && myProfile && (
                    <Bookings
                      onNotice={setNotice}
                      focused={bookingFocus}
                      onExpense={id=>goTab("expenses",id)}
                      onPlan={(r) => { goTab("plan"); setDate(text(r.data.date)); setSelected(r.id); }}
                      workspace={workspace}
                      profile={myProfile}
                      readOnly={readOnly}
                      onSave={async (
                        data,
                        r,
                        place,
                        expense,
                        expenseVersion,
                        addToPlan
                      ) => {
                        if(place)await suggestTravelCity(place,text(data.startDate,workspace.trip.startDate),text(data.endDate,workspace.trip.endDate));
                        if(wsRef.current?.trip.id!==workspace.trip.id)throw new Error("여행이 바뀌었어요. 다시 저장해 주세요.");
                        const id = r?.id ?? crypto.randomUUID();
                        const saving=commit(
                          {
                            data,
                            id,
                            version: r?.version,
                            ...(place ? { place } : {}),
                            ...(expense !== undefined
                              ? { expense, expenseVersion }
                              : {}),
                          },
                          "save-booking", previewSave("booking", data, id)
                        );
                        if(addToPlan&&!workspace.records.some(p=>p.kind==="plan"&&p.data.bookingId===id)){const next=await saving;const linked=next.records.filter(p=>p.kind==="plan"&&p.data.bookingId===id);const plan=linked.find(p=>["departure","checkin","tour"].includes(String(p.data.bookingEvent)))||linked[0];goTab("plan");setDate(text(plan?.data.date,text(data.startDate)));setPlanBooking(id);setEditing(plan);setModal("plan");}else await saving;
                      }}
                      onDelete={(r) => void remove(r)}
                      fileCommand={fileCommand}
                    />
                  )}
                  {tab === "categories" && (
                    <CategorySettings
                      workspace={workspace}
                      disabled={readOnly}
                      onSave={settings}
                    />
                  )}
                  {tab === "tools" && myProfile && (
                    <Tools
                      workspace={workspace}
                      readOnly={readOnly}
                      profile={myProfile}
                      onTripSettings={() => setModal("trip")}
                    />
                  )}
                </div>
              )}
            </PullToRefresh>
          </main>
          <MobileTripNav
            tab={
              accountScreen ? "settings" : atHome || !workspace ? "home" : tab
            }
            disabled={false}
            onSelect={goSection}
          />
          {modal === "travel-settings" && workspace && (
            <Dialog title="여행 설정" onClose={() => setModal(null)}>
              <TripSettingsPage
                key={workspace.trip.id}
                workspace={workspace}
                disabled={busy}
                onEdit={() => setModal("trip")}
                onBackup={backup}
                onImport={() => importInput.current?.click()}
                members={
                  <Members
                    workspace={workspace}
                    busy={busy}
                    onChange={accept}
                    onError={setError}
                  />
                }
              />
            </Dialog>
          )}
          {!openingTrip && <NetworkStatus
            active={busy || listLoading}
            label={busy ? "저장 중" : "불러오는 중"}
          />}
          <input
            type="file"
            ref={importInput}
            hidden
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
            }}
          />
          {notice&&<Toast message={notice}/>}
          {(modal === "create" || modal === "trip") && (
            <TripForm
              trip={modal === "trip" ? workspace?.trip : undefined}
              onClose={() => setModal(null)}
              onSave={async (data) => {
                const next =
                  modal === "create"
                    ? await run<Workspace>("/api/trips", data)
                    : await commit({
                        action: "update-trip",
                        data,
                        version: workspace!.trip.version,
                        revision: workspace!.revision,
                      });
                const intended = Array.isArray(data.cities) ? data.cities : [];
                if (
                  intended.length !==
                    (next.trip.settings.cities ?? []).length ||
                  intended.some(
                    (c) =>
                      !(next.trip.settings.cities ?? []).some(
                        (saved) => saved.id === c.id
                      )
                  )
                )
                  throw new Error(
                    "서버에서 도시 저장을 확인하지 못했어요. 새로고침 후 다시 저장해 주세요."
                  );
                accept(next);
                setAtHome(false);
                setNotice("저장했어북");
                setDate(next.trip.startDate);
                setModal(null);
              }}
              onCopy={
                workspace
                  ? async () => {
                      try {
                        if (!copyAttempt.current || copyAttempt.current.sourceId !== workspace.trip.id) {
                          copyAttempt.current = {
                            sourceId: workspace.trip.id,
                            key: crypto.randomUUID(),
                            workspace: {
                              ...workspace,
                              brainstorm: await exportBrainDocuments(workspace.trip.id),
                              trip: { ...workspace.trip, title: `${workspace.trip.title.slice(0, 190)} (복사)` },
                              records: workspace.records.filter(r => r.kind !== "expense"),
                            },
                          };
                        }
                        await importWorkspace(copyAttempt.current.workspace, copyAttempt.current.key);
                        copyAttempt.current = null;
                        setModal(null);
                        setNotice(
                          "여행을 복사했어북. 동행과 파일 원본·경비는 포함되지 않아북"
                        );
                      } catch (e) {
                        fail(e);
                      }
                    }
                  : undefined
              }
              onDelete={
                workspace?.trip.role === "owner"
                  ? async () => {
                      if (
                        !(await confirm(
                          `“${workspace.trip.title}” 여행과 첨부파일 ${workspace.files.length}개를 서버에서 삭제할까요? 친구도 더 이상 볼 수 없어요.`
                        ))
                      )
                        return;
                      for (const file of workspace.files)
                        await removeFile(file, fileCommand);
                      await run(
                        `/api/trips/${workspace.trip.id}`,
                        { revision: wsRef.current!.revision },
                        "DELETE"
                      );
                      setTrips((t) =>
                        t.filter((x) => x.id !== workspace.trip.id)
                      );
                      setWorkspace(null);
                      setModal(null);
                    }
                  : undefined
              }
            />
          )}
          {modal === "plan" && workspace && (
            <PlanComposer
              workspace={workspace}
              date={currentDate}
              record={editing}
              initialBookingId={planBooking}
              onNotice={setNotice}
              onClose={() => setModal(null)}
              onSave={async (data, place) => {
                const chosen=place||(!editing||editing.data.placeId!==data.placeId?wsRef.current?.records.find(r=>r.kind==="place"&&r.id===data.placeId)?.data as MapPlace|undefined:undefined);
                if(chosen)await suggestTravelCity(chosen,text(data.date,currentDate));
                if(wsRef.current?.trip.id!==workspace.trip.id)throw new Error("여행이 바뀌었어요. 다시 저장해 주세요.");
                const id = editing?.id ?? crypto.randomUUID();
                await commit(
                  {
                    data,
                    id,
                    version: editing?.version,
                    ...(place ? { place } : {}),
                  },
                  "save-plan", previewSave("plan", data, id)
                );
                setNotice("저장했어북");
              }}
            />
          )}
          {token && (
            <Dialog
              title="여행에 함께해북"
              onClose={() => {
                setToken(null);
                history.replaceState(null, "", "/");
              }}
            >
              <div className="stack">
                <p>로그인하고 초대 링크로 여행에 참여할 수 있어북</p>
                {user ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        const next = await run<Workspace>(
                          `/api/invites/${token}`,
                          {}
                        );
                        accept(next);
                        setDate(next.trip.startDate);
                        setToken(null);
                        history.replaceState(null, "", "/");
                      } catch {}
                    }}
                  >
                    여행 참여하기
                  </button>
                ) : (
                  <AuthPanel
                    onAuthenticated={() =>
                      void api<{ user: CurrentUser | null }>("/api/me")
                        .then((r) => changeUser(r.user))
                        .catch(fail)
                    }
                  />
                )}
              </div>
            </Dialog>
          )}
        </div>
      </CalendarCountry.Provider>
    </SearchLanguage.Provider>
  );
}
