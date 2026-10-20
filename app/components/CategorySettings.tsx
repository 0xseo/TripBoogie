"use client";
import { useState } from "react";
import { ChevronRight, ListChecks, Coins, Ticket, Tags } from "lucide-react";
import type { Workspace, Category } from "../types";
import { fileTagCategories } from "../file-library";
import { bookingCategories } from "../booking-categories";
import {
  expenseCategories,
  defaultExpenseCategories,
} from "../expense-categories";
import CategoryEditor from "./CategoryEditor";
export default function CategorySettings({
  workspace,
  disabled,
  onSave,
}: {
  workspace: Workspace;
  disabled: boolean;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [section, setSection] = useState<
    | "checklistCategories"
    | "expenseCategories"
    | "bookingCategories"
    | "fileTags"
    | null
  >(null);
  const groups = [
    {
      id: "checklistCategories" as const,
      label: "체크리스트",
      icon: ListChecks,
    },
    { id: "expenseCategories" as const, label: "경비", icon: Coins },
    { id: "bookingCategories" as const, label: "예약", icon: Ticket },
    { id: "fileTags" as const, label: "자료 태그", icon: Tags },
  ];
  const current =
    section === "fileTags"
      ? fileTagCategories(workspace.trip.settings)
      : section === "bookingCategories"
        ? bookingCategories(workspace.trip.settings)
        : section === "expenseCategories"
          ? expenseCategories(workspace.trip.settings)
          : section
            ? workspace.trip.settings[section]
            : [];
  return (
    <section className="category-settings">
      <div className="settings-menu">
        {groups.map((g) => (
          <button
            type="button"
            key={g.id}
            disabled={disabled}
            onClick={() => setSection(g.id)}
          >
            <g.icon size={20} />
            <span>
              <strong>{g.label}</strong>
              <small>
                {(g.id === "fileTags"
                  ? fileTagCategories(workspace.trip.settings)
                  : g.id === "bookingCategories"
                    ? bookingCategories(workspace.trip.settings)
                    : g.id === "expenseCategories"
                      ? expenseCategories(workspace.trip.settings)
                      : workspace.trip.settings[g.id]
                )
                  .map((c) => c.label)
                  .join(" · ")}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {section && (
        <CategoryEditor
          title={
            section === "fileTags"
              ? "자료 태그"
              : `${groups.find((g) => g.id === section)!.label} 분류`
          }
          noun={section === "fileTags" ? "태그" : "분류"}
          items={current}
          booking={section === "bookingCategories"}
          protectedIds={
            section === "fileTags"
              ? ["hotel", "flight", "tour"]
              : section === "expenseCategories"
                ? defaultExpenseCategories.map((c) => c.id)
                : []
          }
          onClose={() => setSection(null)}
          onSave={async (items: Category[]) => {
            await onSave({ [section]: items });
          }}
        />
      )}
    </section>
  );
}
