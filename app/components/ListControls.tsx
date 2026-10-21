"use client";
import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import ChoiceField from "./ChoiceField";
import styles from "./ListControls.module.css";

export default function ListControls({ label, query, onQuery, order, onOrder, options, count, footer }: {
  label: string;
  query: string;
  onQuery: (value: string) => void;
  order: string;
  onOrder: (value: string) => void;
  options: { id: string; label: string }[];
  count: number;
  footer?: ReactNode;
}) {
  return <div className={styles.controls} data-list-controls={label}>
    <div className={styles.search}>
      <Search size={18} aria-hidden="true" />
      <input type="search" aria-label={`${label} 검색`} placeholder={`${label} 검색`}
        value={query} onChange={e => onQuery(e.target.value)} />
      {!footer && <small className={styles.inlineCount} role="status" aria-label={`${query.trim() ? "검색 결과" : label} ${count.toLocaleString("ko-KR")}개`}>{count.toLocaleString("ko-KR")}개</small>}
      {query && <button type="button" aria-label={`${label} 검색 지우기`} onClick={() => onQuery("")}><X size={16} /></button>}
    </div>
    <div className={styles.order}><ChoiceField label={`${label} 정렬`} value={order} options={options} onChange={onOrder} /></div>
    {footer && <div className={styles.footer}>
      <small className={styles.count} role="status">
        {query.trim() ? "검색 결과 " : label === "체크리스트" ? "할 일 " : `${label} `}{count.toLocaleString("ko-KR")}개
      </small>
      {footer}
    </div>}
  </div>;
}
