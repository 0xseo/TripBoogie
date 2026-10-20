"use client";
import { Fragment } from "react";
import { Compass, MapPin, Plane } from "lucide-react";
import type { Trip } from "../types";
import {
  tripLengthLabel,
  tripCountdown,
  tripStatus,
  type TripColumns,
} from "../trip-collection";
import Avatar from "./Avatar";
import styles from "./TripGrid.module.css";

export default function TripGrid({
  trips,
  today,
  columns,
  disabled,
  onOpen,
  hasTrips,
  onReset,
  showEmpty = true,
  groupByStatus = false,
}: {
  trips: Trip[];
  today: string;
  columns: TripColumns;
  disabled: boolean;
  onOpen: (trip: Trip) => void;
  hasTrips: boolean;
  onReset: () => void;
  showEmpty?: boolean;
  groupByStatus?: boolean;
}) {
  return (
    <div className="trip-grid collection-grid" data-columns={columns}>
      {trips.map((trip, index) => (
        <Fragment key={trip.id}>
          {groupByStatus && (index === 0 || tripStatus(trips[index - 1], today) !== tripStatus(trip, today)) && (
            <h2 className={styles.groupTitle}>{ {ongoing: "여행 중", upcoming: "다가오는 여행", past: "지난 여행"}[tripStatus(trip, today)] }</h2>
          )}
        <article className="trip-card" key={trip.id}>
          <div className="trip-cover">
            <div className="trip-cover-topline">
              <span className="trip-destination">
                <MapPin size={16} />
                <span>{trip.destination}</span>
              </span>
              <span className="trip-countdown">
                {tripStatus(trip,today)==="ongoing"?"여행 중":tripCountdown(trip.startDate,today)}
              </span>
            </div>
            <span className="cover-symbol" aria-hidden="true"><Plane size={64} strokeWidth={1.4}/></span>
            <span className="trip-days">{tripLengthLabel(trip)}</span>
          </div>
          <div className={styles.info}>
            <small className={styles.period}>
              {trip.startDate.replaceAll("-", ".")} —{" "}
              {trip.endDate.slice(5).replaceAll("-", ".")}
            </small>
            <h3 className={styles.title}>
              <button
                className={styles.open}
                onClick={() => onOpen(trip)}
                disabled={disabled}
              >
                {trip.title}
                <span className="card-hit-area" />
              </button>
            </h3>
            <div className={styles.members}>
              <span className="trip-members">
                <span className="avatar-stack">
                  {(trip.memberPreview?.length
                    ? trip.memberPreview
                    : [{ id: "owner", name: "북" }]
                  ).map((m) => (
                    <Avatar key={m.id} name={m.name} src={m.avatar} />
                  ))}
                </span>
                <small>{trip.memberCount}</small>
              </span>
            </div>
          </div>
        </article>
        </Fragment>
      ))}
      {showEmpty && trips.length === 0 && (
        <div className="collection-empty">
          <Compass size={32} />
          <h3>
            {hasTrips
              ? "조건에 맞는 여행이 없어요"
              : "첫 여행 노트를 만들어 볼까요?"}
          </h3>
          <p>
            {hasTrips
              ? "검색어나 필터를 바꿔 보세요."
              : "새 여행을 누르고 함께 떠날 곳을 정해요."}
          </p>
          {hasTrips && (
            <button type="button" onClick={onReset}>
              검색과 필터 초기화
            </button>
          )}
        </div>
      )}
    </div>
  );
}
