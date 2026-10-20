"use client";
import Form from "./Form";
import { useState } from "react";
import { fixedBookingCategory } from "../booking-categories";
import type { BookingCategory } from "../types";
import SortHandle from "./SortHandle";
import { Plus, Trash2, LockKeyhole } from "lucide-react";
import { Dialog } from "./ui";
export type Category = { id: string; label: string };
export default function CategoryEditor({
  title,
  booking = false,
  protectedIds = [],
  noun = "분류",
  items,
  onSave,
  onClose,
}: {
  title: string;
  booking?: boolean;
  protectedIds?: string[];
  noun?: string;
  items: Category[];
  onSave: (items: Category[]) => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] =
      useState<(Category & { kind?: BookingCategory["kind"] })[]>(items),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog mobilePage title={title} onClose={onClose}>
      <Form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(rows);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {rows.map((row, i) => (
          <div
            className="category-edit-row"
            key={row.id}
            data-sort-id={row.id}
            data-sort-group="category"
          >
            <SortHandle
              id={row.id}
              group="category"
              ids={rows.map((r) => r.id)}
              label={row.label || `${noun} ${i + 1}`}
              onReorder={(ids) =>
                setRows(ids.map((id) => rows.find((r) => r.id === id)!))
              }
            />
            {booking && fixedBookingCategory(row.id) ? (
              <span className="locked-category-name">{row.label}</span>
            ) : (
              <input
                required
                aria-label={`${noun} ${i + 1}`}
                maxLength={100}
                value={row.label}
                onChange={(e) =>
                  setRows(
                    rows.map((r) =>
                      r.id === row.id ? { ...r, label: e.target.value } : r,
                    ),
                  )
                }
              />
            )}
            {(booking && fixedBookingCategory(row.id)) ||
            protectedIds.includes(row.id) ? (
              <LockKeyhole
                size={16}
                className="category-lock"
                aria-label={`기본 ${noun}`}
              />
            ) : (
              <button
                type="button"
                className="icon"
                aria-label={`${row.label} ${noun} 삭제`}
                onClick={() => setRows(rows.filter((r) => r.id !== row.id))}
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={rows.length >= 50}
          onClick={() =>
            setRows([
              ...rows,
              {
                id: crypto.randomUUID(),
                label: "",
                ...(booking ? { kind: "other" as const } : {}),
              },
            ])
          }
        >
          <Plus size={18} />
          {noun} 추가
        </button>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "저장 중…" : `${noun} 저장`}
        </button>
      </Form>
    </Dialog>
  );
}
