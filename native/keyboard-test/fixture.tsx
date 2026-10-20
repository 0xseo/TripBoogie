// Compiled only into the instrumentation APK, never the application APK.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import Bookings, { BookingForm } from "../../app/components/Bookings";
import PlanComposer from "../../app/components/PlanComposer";
import Expenses, { ExpenseForm } from "../../app/components/Expenses";
import Files from "../../app/components/Files";
import FilePreview from "../../app/components/FilePreview";
import Tools from "../../app/components/Tools";
import { previewBlob, auditDocuments } from "./documents";
import { defaultExpenseCategories } from "../../app/expense-categories";
import TripForm from "../../app/components/TripForm";
import Checklist from "../../app/components/Checklist";
import CategoryEditor from "../../app/components/CategoryEditor";
import AccountSettings from "../../app/components/AccountSettings";
import PlacePicker from "../../app/components/PlacePicker";
import ManualPlacePicker from "../../app/components/ManualPlacePicker";
import TripCollectionControls from "../../app/components/TripCollectionControls";
import ItineraryEditor from "../../app/ItineraryEditor";
import { dayGraph } from "../../app/route-graph";
import KeyboardFocus from "../../app/components/KeyboardFocus";
import { MobileTripNav } from "../../app/components/TripNavigation";
import Toast from "../../app/components/Toast";
import PullToRefresh from "../../app/components/PullToRefresh";
import NetworkStatus from "../../app/components/NetworkStatus";
import { ConfirmationProvider } from "../../app/components/Confirmation";
import { Dialog } from "../../app/components/ui";
import type { Workspace, Profile, ItemRecord } from "../../app/types";
import "../../app/styles.css";
import "../native.css";
const noop = () => {},
  save = async () => {};
const profile: Profile = {
  id: "test",
  name: "검증 계정",
  email: "test@example.invalid",
  baseCurrency: "KRW",
  version: 1,
};
const row = (
  id: string,
  kind: ItemRecord["kind"],
  data: Record<string, unknown>,
): ItemRecord => ({
  id,
  kind,
  data,
  version: 1,
  updatedAt: "",
  updatedBy: "test",
});
const memo = Array.from(
  { length: 60 },
  (_, i) =>
    `${i + 1}번째 줄 · 예약 및 일정 메모 입력 중 커서가 가리지 않는지 확인합니다.`,
).join("\n");
const bookings = ["flight", "hotel", "tour", "other"].map((type) =>
  row(type, "booking", {
    type,
    placeId: type === "hotel" ? "b" : "",
    title:
      type === "hotel"
        ? "검증 숙소"
        : type === "tour"
          ? "검증 투어"
          : "검증 예약",
    startDate: "2026-11-01",
    endDate: "2026-11-03",
    startTime: "09:15",
    endTime: "13:20",
    departure: "ICN",
    arrival: "AKL",
    flightNumber: "KE411",
    note: memo,
    platform: "예약 플랫폼",
    reference: "ABC123",
    roomName: "디럭스 트윈",
    moneyAmount: 1000,
  }),
);
const routePlaces = [
  row("a", "place", {
    name: "서울역",
    address: "서울 용산구 한강대로 405",
    lat: 37.55,
    lng: 126.97,
  }),
  row("b", "place", { name: "숙소", lat: 37.56, lng: 126.98 }),
];
const routePlans = Array.from({ length: 10 }, (_, i) =>
  row("plan" + i, "plan", {
    title: `일정 ${i + 1}`,
    date: "2026-11-01",
    placeId: i % 2 ? "b" : "a",
    position: i,
    travelMinutes: 10,
    transportMode: "walk",
  }),
);
const graph = dayGraph(routePlans, routePlaces);
const workspace: Workspace = {
  trip: {
    id: "test",
    title: "키보드 검증 여행",
    destination: "서울",
    startDate: "2026-11-01",
    endDate: "2026-11-04",
    currency: "KRW",
    timezone: "Asia/Seoul",
    settings: {
      expenseCategories: [{ id: "food", label: "식비" }],
      checklistCategories: [{ id: "prepare", label: "준비" }],
    },
    version: 1,
    revision: 1,
    role: "owner",
    memberCount: 1,
    createdAt: "",
    updatedAt: "",
  },
  revision: 1,
  members: [
    {
      id: "test",
      name: "검증 계정",
      email: "test@example.invalid",
      role: "owner",
    },
  ],
  files: [],
  records: [
    ...bookings,
    ...routePlaces,
    row("tour-plan", "plan", {
      bookingId: "tour",
      date: "2026-11-01",
      title: "연결 투어 일정",
    }),
  ],
};
// No live account, maps provider, or reservation writes are used by this test.
window.fetch = async (input, init) => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  window.keyboardFixture.requests.push({ url: String(input), body });
  return Response.json(
    String(input).includes("auth-config")
      ? {
          url: "",
          publishableKey: "",
          providers: { email: false, google: false, kakao: false },
        }
      : {
          places: [],
          holidays: [],
          supported: false,
          time: 600,
          base: body.base,
          quote: body.quote,
          rate: body.base === "JPY" ? 10 : 800,
          date: "2026-11-01",
          daily: [{ date: "2026-11-01", code: 0, high: 20, low: 12, rain: 10 }],
          message: "",
        },
  );
};
declare global {
  interface Window {
    keyboardFixture: {
      show: (scene: string) => void;
      saved: unknown[];
      memo: string;
      ready: boolean;
      notices: string[];
      refreshes: number;
      requests: unknown[];
      auditDocuments: typeof auditDocuments;
      finishRefresh?: (fail?: boolean) => void;
    };
  }
}
window.keyboardFixture = {
  show: noop,
  saved: [],
  memo,
  ready: false,
  notices: [],
  refreshes: 0,
  requests: [],
  auditDocuments,
};
function Fixture() {
  const [scene, setScene] = useState(
      new URLSearchParams(location.search).get("scene") || "toast",
    ),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState("");
  const notify = (message: string) => {
    window.keyboardFixture.notices.push(message);
    setNotice(message);
  };
  const hotelWorkspace = {
    ...workspace,
    records:
      scene === "plan-hotels"
        ? [
            ...workspace.records,
            row("hotel2", "booking", {
              ...bookings[1].data,
              title: "두 번째 숙소",
              placeId: "a",
            }),
          ]
        : scene === "plan-hotel-missing"
          ? workspace.records.map((r) =>
              r.id === "hotel" ? { ...r, data: { ...r.data, placeId: "" } } : r,
            )
          : workspace.records,
  };
  window.keyboardFixture.show = setScene;
  window.keyboardFixture.ready = true;
  const cities = [
    {
      id: "akl",
      name: "오클랜드",
      countryCode: "NZ",
      currency: "NZD",
      timezone: "Pacific/Auckland",
      lat: -36.85,
      lng: 174.76,
      address: "NZ",
      startDate: "2026-11-01",
      endDate: "2026-11-04",
    },
    {
      id: "rot",
      name: "로토루아",
      countryCode: "NZ",
      currency: "NZD",
      timezone: "Pacific/Auckland",
      lat: -38.14,
      lng: 176.25,
      address: "NZ",
      startDate: "2026-11-01",
      endDate: "2026-11-04",
      transit: true,
    },
    {
      id: "tok",
      name: "도쿄",
      countryCode: "JP",
      currency: "JPY",
      timezone: "Asia/Tokyo",
      lat: 35.68,
      lng: 139.69,
      address: "JP",
      startDate: "2026-11-01",
      endDate: "2026-11-04",
    },
  ];
  const multi = {
    ...workspace,
    trip: {
      ...workspace.trip,
      currency: "NZD",
      settings: {
        ...workspace.trip.settings,
        cities,
        countries: ["NZ", "JP"],
        currencies: ["NZD", "JPY"],
      },
    },
    records: [
      row("e1", "expense", {
        model: 2,
        title: "엔화 사용",
        date: "2026-11-01",
        tripCurrency: "JPY",
        baseCurrency: "KRW",
        paidCurrency: "JPY",
        tripAmount: "2",
        baseAmount: "20",
        exchangeRate: 10,
      }),
      row("e2", "expense", {
        model: 2,
        title: "원화 사용",
        date: "2026-11-01",
        tripCurrency: "NZD",
        baseCurrency: "KRW",
        paidCurrency: "KRW",
        tripAmount: ".0375",
        baseAmount: "30",
        exchangeRate: 800,
      }),
    ],
  };
  const [files, setFiles] = useState(
    Array.from({ length: 5 }, (_, i) => ({
      id: "f" + i,
      trip_id: "test",
      booking_id: null,
      name: [
        "항공 예약.pdf",
        "숙소 확인.docx",
        "여행 경비.xlsx",
        "주소.txt",
        "사진.png",
      ][i],
      mime:
        i === 0
          ? "application/pdf"
          : i === 4
            ? "image/png"
            : "application/octet-stream",
      size: 1200,
      path: "test/f" + i,
      version: 1,
      tags: [i === 1 ? "hotel" : "flight"],
      status: "ready" as const,
      created_at: "2026-10-20T00:00:00Z",
      uploaded_by: "test",
    })),
  );
  const type = scene.split("-")[1],
    booking = bookings.find((b) => b.data.type === type);
  return (
    <ConfirmationProvider>
      <KeyboardFocus />
      <main style={{ padding: 16, paddingBottom: 90 }}>
        {scene === "attachments" && (
          <Files
            bookingId="flight"
            workspace={{
              ...workspace,
              files: files.map((f) => ({ ...f, booking_id: "flight" })),
            }}
            readOnly={false}
            command={async () => ({ file: null, workspace })}
          />
        )}
        {scene === "categories-expense" && (
          <CategoryEditor
            title="경비 분류"
            items={defaultExpenseCategories}
            protectedIds={defaultExpenseCategories.map((c) => c.id)}
            onSave={save}
            onClose={noop}
          />
        )}
        {scene === "booking-cards" && (
          <Bookings
            workspace={{
              ...workspace,
              records: [
                {
                  ...bookings[0],
                  data: {
                    ...bookings[0].data,
                    moneyCurrency: "NZD",
                    isPaid: true,
                    expenseId: "e1",
                  },
                },
                row("fp", "plan", {
                  date: "2026-11-01",
                  time: "09:15",
                  bookingId: "flight",
                  bookingEvent: "departure",
                }),
                row("e1", "expense", {
                  model: 2,
                  bookingId: "flight",
                  tripCurrency: "NZD",
                  baseCurrency: "KRW",
                  paidCurrency: "NZD",
                  tripAmount: "1000",
                  baseAmount: "800000",
                }),
              ],
            }}
            profile={profile}
            readOnly={false}
            focused="flight"
            onSave={save}
            onDelete={noop}
            onPlan={noop}
            onExpense={(id) =>
              window.keyboardFixture.saved.push(["expense-navigation", id])
            }
            onNotice={notify}
            fileCommand={async () => ({ file: null, workspace })}
          />
        )}
        {scene === "connected-expenses" && (
          <Expenses
            workspace={{
              ...workspace,
              records: [
                bookings[0],
                row("e1", "expense", {
                  model: 2,
                  title: "항공 경비",
                  category: "flight",
                  bookingId: "flight",
                  period: "before",
                  date: "2026-10-20",
                  tripCurrency: "NZD",
                  baseCurrency: "KRW",
                  paidCurrency: "NZD",
                  tripAmount: "1000",
                  baseAmount: "800000",
                  payers: [],
                  participants: [],
                }),
              ],
            }}
            profile={profile}
            date="2026-11-01"
            readOnly={false}
            onSave={save}
            onDelete={noop}
            onBooking={(id) =>
              window.keyboardFixture.saved.push(["booking-navigation", id])
            }
          />
        )}
        {scene === "files" && (
          <Files
            workspace={{ ...workspace, files }}
            readOnly={false}
            command={async (op, payload) => {
              window.keyboardFixture.saved.push([op, payload]);
              if (op === "set-files-tags")
                setFiles((rows) =>
                  rows.map((f) =>
                    (payload.files as { id: string }[]).some(
                      (p) => p.id === f.id,
                    )
                      ? {
                          ...f,
                          tags: payload.tags as string[],
                          version: f.version + 1,
                        }
                      : f,
                  ),
                );
              return { file: null, workspace };
            }}
          />
        )}
        {scene.startsWith("preview-") && (
          <FilePreview
            key={scene}
            file={{
              ...files[0],
              name: "여행 자료." + scene.slice(8),
              mime:
                scene === "preview-pdf"
                  ? "application/pdf"
                  : scene === "preview-png"
                    ? "image/png"
                    : "application/octet-stream",
            }}
            load={async () => previewBlob(scene.slice(8))}
            onClose={noop}
          />
        )}
        {scene === "tags-protected" && (
          <CategoryEditor
            title="자료 태그"
            noun="태그"
            protectedIds={["hotel", "flight", "tour"]}
            items={[
              { id: "hotel", label: "숙소" },
              { id: "flight", label: "항공" },
              { id: "tour", label: "투어티켓" },
              { id: "other", label: "기타" },
            ]}
            onSave={save}
            onClose={noop}
          />
        )}
        {scene === "expenses-multi" && (
          <Expenses
            workspace={multi}
            profile={profile}
            date="2026-11-01"
            readOnly={false}
            onSave={save}
            onDelete={noop}
          />
        )}
        {scene === "expense-multi-new" && (
          <ExpenseForm
            workspace={{
              ...multi,
              records: [
                ...multi.records,
                ...bookings.map((b) => ({
                  ...b,
                  data: { ...b.data, moneyCurrency: "NZD" },
                })),
              ],
            }}
            profile={profile}
            categories={workspace.trip.settings.expenseCategories}
            initialPeriod="day"
            initialDate="2026-11-01"
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
          />
        )}
        {scene === "tools-multi" && (
          <Tools
            workspace={multi}
            profile={profile}
            readOnly={false}
            onTripSettings={noop}
          />
        )}
        {scene === "trip-multi" && (
          <TripForm
            trip={multi.trip}
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
          />
        )}
        {scene === "trip-country" && (
          <TripForm
            trip={{
              ...workspace.trip,
              settings: { ...workspace.trip.settings, countries: ["NZ"] },
            }}
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
          />
        )}
        {scene === "plan-place" && (
          <PlanComposer
            workspace={workspace}
            date="2026-11-01"
            record={row("p", "plan", {
              title: "서울역 방문",
              time: "09:15",
              placeId: "a",
              date: "2026-11-01",
            })}
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
            onNotice={notify}
          />
        )}
        {scene === "travel" && (
          <ItineraryEditor
            workspace={{
              ...workspace,
              records: [...routePlaces, ...routePlans],
            }}
            date="2026-11-01"
            days={["2026-11-01"]}
            plans={routePlans}
            places={routePlaces}
            connections={graph.connections}
            disabled={false}
            onSchedule={async () => workspace}
            onEdit={noop}
            onRemove={noop}
            onAdd={noop}
            onError={noop}
            onBooking={noop}
            onSave={save}
            onEstimate={save}
          />
        )}
        {scene.startsWith("booking-") && scene !== "booking-cards" && (
          <BookingForm
            key={scene}
            workspace={
              scene === "booking-tour-unlinked"
                ? {
                    ...workspace,
                    records: workspace.records.filter((r) => r.kind !== "plan"),
                  }
                : scene.endsWith("-paid") || scene.endsWith("-group")
                  ? {
                      ...multi,
                      records: workspace.records,
                      members: scene.endsWith("-group")
                        ? [
                            ...workspace.members,
                            {
                              id: "buddy",
                              name: "동행 둘",
                              email: "buddy@example.invalid",
                              role: "editor",
                            },
                            {
                              id: "third",
                              name: "동행 셋",
                              email: "third@example.invalid",
                              role: "editor",
                            },
                          ]
                        : workspace.members,
                    }
                  : scene === "booking-flight-linked"
                    ? {
                        ...workspace,
                        records: [
                          ...workspace.records,
                          row("fp", "plan", {
                            bookingId: "flight",
                            date: "2026-11-01",
                          }),
                        ],
                      }
                    : workspace
            }
            profile={profile}
            type={type}
            record={scene.endsWith("-new") ? undefined : booking}
            onNotice={notify}
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
          />
        )}
        {scene.startsWith("plan-hotel") && (
          <PlanComposer
            key={scene}
            workspace={hotelWorkspace}
            date="2026-11-02"
            initialBookingId={
              scene === "plan-hotel-linked" ? "tour" : undefined
            }
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
            onNotice={notify}
          />
        )}
        {scene === "plan-no-hotel" && (
          <PlanComposer
            workspace={workspace}
            date="2026-11-04"
            onSave={save}
            onClose={noop}
            onNotice={notify}
          />
        )}
        {scene === "refresh" && (
          <>
            <header className="app-header">새로고침 검증</header>
            <PullToRefresh
              enabled
              onRefresh={() =>
                new Promise<void>((resolve, reject) => {
                  window.keyboardFixture.refreshes++;
                  window.keyboardFixture.finishRefresh = (fail) =>
                    fail ? reject(new Error("검증 실패")) : resolve();
                })
              }
            >
              <section data-refresh-test style={{ minHeight: "150vh" }}>
                화면을 아래로 당겨 주세요.
              </section>
            </PullToRefresh>
            <NetworkStatus active />
          </>
        )}
        {scene === "plan" && (
          <PlanComposer
            workspace={workspace}
            date="2026-11-01"
            record={row("plan", "plan", {
              title: "일정 입력",
              time: "09:15",
              duration: 60,
              note: memo,
            })}
            onSave={save}
            onClose={noop}
            onNotice={notify}
          />
        )}
        {scene.startsWith("linked-plan-") && (
          <PlanComposer
            key={scene}
            workspace={workspace}
            date="2026-11-01"
            record={row("linked-plan", "plan", {
              entryType: "plan",
              title: "연결된 일정",
              date: "2026-11-01",
              time: "09:15",
              bookingId: scene.slice("linked-plan-".length),
              bookingEvent: "manual",
              note: memo,
            })}
            onSave={async (...args) => {
              window.keyboardFixture.saved.push(args);
            }}
            onClose={noop}
            onNotice={notify}
          />
        )}
        {scene === "memo" && (
          <PlanComposer
            workspace={workspace}
            date="2026-11-01"
            record={row("memo", "plan", { entryType: "memo", note: memo })}
            onSave={save}
            onClose={noop}
            onNotice={notify}
          />
        )}
        {scene === "expense" && (
          <ExpenseForm
            workspace={workspace}
            profile={profile}
            record={row("expense", "expense", {
              model: 2,
              title: "검증 식사",
              amount: 1000,
              tripAmount: 1000,
              baseAmount: 1000,
              tripCurrency: "USD",
              baseCurrency: "KRW",
              paidCurrency: "USD",
              exchangeRate: 1,
              date: "2026-11-01",
              note: memo,
              payers: [{ userId: "test", name: "검증 계정", amount: "1000" }],
              participants: [
                { userId: "test", name: "검증 계정", amount: "1000" },
              ],
            })}
            categories={workspace.trip.settings.expenseCategories}
            initialPeriod="day"
            initialDate="2026-11-01"
            onSave={save}
            onClose={noop}
          />
        )}
        {scene === "trip" && (
          <TripForm trip={workspace.trip} onSave={save} onClose={noop} />
        )}
        {scene === "trip-new" && <TripForm onSave={save} onClose={noop} />}
        {scene === "checklist" && (
          <Checklist
            workspace={workspace}
            userId="test"
            readOnly={false}
            onSave={save}
            onDelete={noop}
            onToggle={save}
            onReorder={save}
          />
        )}
        {scene === "categories" && (
          <CategoryEditor
            title="분류 수정"
            items={Array.from({ length: 12 }, (_, i) => ({
              id: String(i),
              label: `분류 ${i + 1}`,
            }))}
            onSave={save}
            onClose={noop}
          />
        )}
        {scene === "account" && (
          <AccountSettings
            profile={profile}
            onSave={save}
            onLogout={noop}
            signingOut={false}
            onAuthenticated={noop}
            onWithdraw={save}
          />
        )}
        {scene === "place" && (
          <Dialog mobilePage title="장소 검색" onClose={noop}>
            <PlacePicker onChoose={noop} />
          </Dialog>
        )}
        {scene === "manual" && (
          <ManualPlacePicker
            initial={{
              name: "장소 입력",
              address: "서울",
              lat: 37.55,
              lng: 126.97,
            }}
            onChoose={noop}
            onClose={noop}
          />
        )}
        {scene === "search" && (
          <TripCollectionControls
            query={query}
            onQuery={setQuery}
            columns={2}
            onColumns={noop}
            sort="upcoming"
            onSort={noop}
            filter={{ status: "all", ownership: "all", destination: "" }}
            onFilter={noop}
            destinations={[]}
          />
        )}
        <Toast message={notice || "저장했어북"} />
        <MobileTripNav tab="plan" disabled={false} onSelect={noop} />
      </main>
    </ConfirmationProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
