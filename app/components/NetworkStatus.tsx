"use client";
import { useEffect, useState } from "react";
import LoadingOverlay from "./LoadingOverlay";

export default function NetworkStatus({
  active = false,
  label = "불러오는 중",
}: { active?: boolean; label?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(active), active ? 250 : 0);
    return () => clearTimeout(timer);
  }, [active]);
  return active && visible ? <LoadingOverlay label={label} request /> : null;
}
