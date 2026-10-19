"use client";
import { Plus, LoaderCircle } from "lucide-react";
export default function AddButton({ label, onClick, disabled = false, loading = false }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
}) {
    return <button type="button" className="primary add-fab" aria-label={label} aria-busy={loading || undefined} disabled={disabled || loading} onClick={onClick}>{loading ? <LoaderCircle className="spinner" size={24}/> : <Plus size={24}/>}<span>{label}</span></button>;
}
