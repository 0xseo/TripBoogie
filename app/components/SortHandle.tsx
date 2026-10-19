"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Menu } from "lucide-react";
export function movedIds(ids: string[], from: string, to: string) {
    if (from === to || !ids.includes(from) || !ids.includes(to))
        return ids;
    const next = ids.filter(id => id !== from);
    next.splice(ids.indexOf(to), 0, from);
    return next;
}
type Row = {
    node: HTMLElement;
    id: string;
    top: number;
    height: number;
    transform: string;
    transition: string;
    opacity: string;
};
type Drag = {
    pointer: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    rows: Row[];
    row: Row;
    clone: HTMLElement | null;
    order: string[];
    active: boolean;
    frame: number;
    scrollStart: number;
    scrollNode: HTMLElement | null;
    button: HTMLButtonElement;
};
export default function SortHandle({ id, group, ids, label, disabled, onReorder }: {
    id: string;
    group: string;
    ids: string[];
    label: string;
    disabled?: boolean;
    onReorder: (ids: string[]) => void;
}) {
    const drag = useRef<Drag | null>(null), [menu, setMenu] = useState(false), menuRef = useRef<HTMLDivElement>(null);
    function cleanup() {
        const d = drag.current;
        if (!d)
            return;
        drag.current = null;
        cancelAnimationFrame(d.frame);
        d.clone?.remove();
        for (const r of d.rows) {
            r.node.style.transform = r.transform;
            r.node.style.transition = r.transition;
            r.node.style.opacity = r.opacity;
            r.node.removeAttribute("data-dragging");
        }
        if (d.button.hasPointerCapture(d.pointer))
            d.button.releasePointerCapture(d.pointer);
        drag.current = null;
    }
    useEffect(() => () => cleanup(), []);
    useEffect(() => {
        if (!menu)
            return;
        const close = (e: globalThis.PointerEvent) => { if (!menuRef.current?.contains(e.target as Node))
            setMenu(false); };
        const key = (e: KeyboardEvent) => { if (e.key === "Escape")
            setMenu(false); };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", key);
        return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
    }, [menu]);
    function update() {
        const d = drag.current;
        if (!d)
            return;
        if (!d.active && Math.hypot(d.y - d.startY, d.x - d.startX) > 7) {
            d.active = true;
            setMenu(false);
            const rect = d.row.node.getBoundingClientRect(), clone = d.row.node.cloneNode(true) as HTMLElement;
            clone.removeAttribute("id");
            clone.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
            clone.setAttribute("aria-hidden", "true");
            clone.inert = true;
            clone.classList.add("drag-preview");
            Object.assign(clone.style, { position: "fixed", top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none", zIndex: "9999", transition: "none" });
            // Keep the preview inside the dialog's top layer when applicable.
            (d.button.closest("dialog") || document.body).appendChild(clone);
            d.clone = clone;
            d.row.node.dataset.dragging = "true";
            d.row.node.style.opacity = "0.16";
        }
        if (!d.active)
            return;
        const view = d.button.ownerDocument.defaultView!, bounds = d.scrollNode?.getBoundingClientRect(), top = Math.max(bounds?.top ?? 0, 70), bottom = Math.min(bounds?.bottom ?? view.innerHeight, view.innerHeight - 92);
        const delta = d.y < top + 45 ? -10 : d.y > bottom - 45 ? 10 : 0;
        if (delta) {
            if (d.scrollNode)
                d.scrollNode.scrollBy(0, delta);
            else
                view.scrollBy(0, delta);
        }
        const scroll = (d.scrollNode?.scrollTop ?? view.scrollY) - d.scrollStart;
        d.clone!.style.transform = `translate3d(0,${d.y - d.startY}px,0) scale(1.015)`;
        const others = d.rows.filter(r => r.id !== id), index = others.filter(r => d.y > r.top - scroll + r.height / 2).length;
        const order = others.map(r => r.id);
        order.splice(index, 0, id);
        d.order = order;
        const gap = d.rows.length > 1 ? Math.max(0, d.rows[1].top - d.rows[0].top - d.rows[0].height) : 0;
        let y = d.rows[0].top;
        for (const key of order) {
            const r = d.rows.find(r => r.id === key)!;
            if (key !== id) {
                r.node.style.transition = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "transform 140ms ease";
                r.node.style.transform = `translateY(${y - r.top}px)`;
            }
            y += r.height + gap;
        }
    }
    function start(e: PointerEvent<HTMLButtonElement>) {
        if (e.button !== 0 || disabled)
            return;
        cleanup();
        const button = e.currentTarget, rowNode = button.closest<HTMLElement>("[data-sort-id]");
        if (!rowNode)
            return;
        const nodes = Array.from(rowNode.parentElement!.querySelectorAll<HTMLElement>("[data-sort-id]"));
        const rows = ids.flatMap(key => { const node = nodes.find(n => n.dataset.sortGroup === group && n.dataset.sortId === key); if (!node)
            return []; const rect = node.getBoundingClientRect(); return [{ node, id: key, top: rect.top, height: rect.height, transform: node.style.transform, transition: node.style.transition, opacity: node.style.opacity }]; });
        const row = rows.find(r => r.id === id);
        if (!row)
            return;
        const scrollNode = button.closest<HTMLElement>("[data-sort-scroll],dialog");
        button.setPointerCapture(e.pointerId);
        drag.current = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, rows, row, clone: null, order: [...ids], active: false, frame: 0, scrollStart: scrollNode?.scrollTop ?? window.scrollY, scrollNode, button };
        const tick = () => { if (!drag.current)
            return; update(); drag.current.frame = requestAnimationFrame(tick); };
        drag.current.frame = requestAnimationFrame(tick);
    }
    const index = ids.indexOf(id);
    function move(target: number) { setMenu(false); if (target >= 0 && target < ids.length && target !== index)
        onReorder(movedIds(ids, id, ids[target])); }
    return <div className="sort-control" ref={menuRef}><button type="button" className="icon sort-handle" data-no-pull-refresh="true" aria-label={`${label} 순서 변경`} aria-haspopup="menu" aria-expanded={menu} disabled={disabled} onPointerDown={start} onPointerMove={e => { const d = drag.current; if (d && d.pointer === e.pointerId) {
        d.x = e.clientX;
        d.y = e.clientY;
        update();
    } }} onPointerUp={e => { const d = drag.current; if (!d || d.pointer !== e.pointerId)
        return; const order = d.order, active = d.active; cleanup(); if (active) {
        if (order.some((key, i) => key !== ids[i]))
            onReorder(order);
    }
    else
        setMenu(v => !v); }} onPointerCancel={cleanup} onLostPointerCapture={() => { if (drag.current)
        cleanup(); }} onClick={e => { if (e.detail === 0)
        setMenu(v => !v); }} onKeyDown={e => { if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        move(index + (e.key === "ArrowUp" ? -1 : 1));
    } }}><Menu size={20}/></button>{menu && <div className="sort-menu" role="menu">{[{ label: "맨 위로", index: 0 }, { label: "위로", index: index - 1 }, { label: "아래로", index: index + 1 }, { label: "맨 아래로", index: ids.length - 1 }].map(item => <button type="button" role="menuitem" key={item.label} disabled={item.index < 0 || item.index >= ids.length || item.index === index} onClick={() => move(item.index)}>{item.label}</button>)}</div>}</div>;
}
