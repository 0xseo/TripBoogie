/** Date-only values stay date-only, independent of the device timezone. */
export function shortDate(value: string) {
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()))
        return "";
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()} (${["일", "월", "화", "수", "목", "금", "토"][date.getUTCDay()]})`;
}
export function weekDates(value: string) {
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()))
        return [];
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return Array.from({ length: 7 }, (_, i) => new Date(date.getTime() + i * 86400000).toISOString().slice(0, 10));
}
