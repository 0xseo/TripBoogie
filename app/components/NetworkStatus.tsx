"use client";
import { useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import { getApiPending, subscribeApiActivity } from "../client-api";
import styles from "./NetworkStatus.module.css";

const serverSnapshot = () => 0;
export default function NetworkStatus({
  active = false,
  label = "불러오는 중",
}: { active?: boolean; label?: string }) {
  const pending = useSyncExternalStore(subscribeApiActivity, getApiPending, serverSnapshot);
  if (!active && pending === 0) return null;
  return <div className={styles.status} role="status" aria-label={label}>
    <LoaderCircle className="spinner" size={27} aria-hidden="true" />
  </div>;
}
