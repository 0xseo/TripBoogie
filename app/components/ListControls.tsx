"use client";
import { Search, X } from "lucide-react";
import ChoiceField from "./ChoiceField";
import styles from "./ListControls.module.css";

export default function ListControls({ label, query, onQuery, order, onOrder, options, count }: {
  label: string;
  query: string;
  onQuery: (value: string) => void;
  order: string;
  onOrder: (value: string) => void;
  options: { id: string; label: string }[];
  count: number;
}) {
  return <div className={styles.controls} data-list-controls={label}>
    <div className={styles.search}>
      <Search size={18} aria-hidden="true" />
      <input type="search" aria-label={`${label} 검색`} placeholder={`${label} 검색`}
        value={query} onChange={e => onQuery(e.target.value)} />
      {query && <button type="button" aria-label={`${label} 검색 지우기`} onClick={() => onQuery("")}><X size={16} /></button>}
    </div>
    <div className={styles.order}><ChoiceField label={`${label} 정렬`} value={order} options={options} onChange={onOrder} /></div>
    <small className={styles.count} role="status">{query.trim() ? "검색 결과 " : ""}{count}개</small>
  </div>;
}
