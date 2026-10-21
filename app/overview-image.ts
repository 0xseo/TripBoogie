import { shortDate } from "./calendar";

export type OverviewImageRow = { date: string; text: string };
export type ImageSegment = { date: string; lines: string[]; continued: boolean };
export type OverviewImage = { blob: Blob; width: number; height: number };
const width = 1000, scale = 1.5, padding = 44, dateWidth = 148;
const headerHeight = 188, footerHeight = 62, lineHeight = 30, rowPadding = 32;
const maxHeight = 1900; // 2000 × <=3800 pixels, including on mobile browsers.
// Installed system fonts need no network font loading or document-wide wait.
const fontFamily = '"Apple SD Gothic Neo", system-ui, sans-serif';

export function wrapOverviewText(text: string, measure: (value: string) => number, maxWidth: number) {
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const characters = Array.from(paragraph);
    if (!characters.length) { result.push(""); continue; }
    let start = 0;
    while (start < characters.length) {
      const remaining = characters.length - start;
      let low = 1, high = Math.min(64, remaining);
      const prefix = (count: number) => characters.slice(start, start + count).join("");
      while (measure(prefix(high)) <= maxWidth) {
        low = high;
        if (high === remaining) break;
        high = Math.min(high * 2, remaining);
      }
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (measure(prefix(mid)) <= maxWidth) low = mid;
        else high = mid - 1;
      }
      result.push(prefix(low));
      start += low;
    }
  }
  return result;
}

/** A long day can continue on another image; no text is clipped or scaled to fit. */
export function paginateOverview(rows: OverviewImageRow[], measure: (value: string) => number): ImageSegment[][] {
  const capacity = maxHeight - headerHeight - footerHeight;
  const pages: ImageSegment[][] = [];
  let page: ImageSegment[] = [], remaining = capacity;
  const flush = () => { if (page.length) pages.push(page); page = []; remaining = capacity; };
  for (const row of rows) {
    const lines = wrapOverviewText(row.text, measure, width - 2 * padding - dateWidth - 44);
    let offset = 0;
    if (lines.length * lineHeight + rowPadding <= capacity && lines.length * lineHeight + rowPadding > remaining) flush();
    while (offset < lines.length) {
      const count = Math.min(lines.length - offset, Math.floor((remaining - rowPadding) / lineHeight));
      if (count < 1) { flush(); continue; }
      page.push({ date: row.date, lines: lines.slice(offset, offset + count), continued: offset > 0 });
      remaining -= count * lineHeight + rowPadding;
      offset += count;
      if (offset < lines.length) flush();
    }
  }
  flush();
  return pages;
}

let cached: { key: string; images: OverviewImage[] } | undefined;
export async function renderOverviewImages(title: string, rows: OverviewImageRow[], onProgress?: (done: number, total: number) => void): Promise<OverviewImage[]> {
  const key = JSON.stringify([title, rows]);
  if (cached?.key === key) { onProgress?.(cached.images.length, cached.images.length); return cached.images; }
  const images = await drawOverviewImages(title, rows, onProgress);
  // One bounded, memory-only result; changing any text/date/title regenerates it.
  if (images.reduce((sum, image) => sum + image.blob.size, 0) <= 24 * 1024 * 1024) cached = { key, images };
  return images;
}
async function drawOverviewImages(title: string, rows: OverviewImageRow[], onProgress?: (done: number, total: number) => void): Promise<OverviewImage[]> {
  if (!rows.length) throw new Error("저장할 날짜를 선택해 주세요.");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이 기기에서 이미지를 만들 수 없어요.");
  try {
    context.font = `20px ${fontFamily}`;
    const pages = paginateOverview(rows, value => context.measureText(value).width);
    if (pages.length > 40) throw new Error("이미지가 40장을 넘어요. 날짜 범위를 나눠서 저장해 주세요.");
    onProgress?.(0, pages.length);
    const images: OverviewImage[] = [];
    for (const [index, segments] of pages.entries()) {
      const height = headerHeight + footerHeight + segments.reduce((sum, row) => sum + row.lines.length * lineHeight + rowPadding, 0);
      canvas.width = width * scale;
      canvas.height = height * scale;
      context.scale(scale, scale);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.textBaseline = "top";
      context.fillStyle = "#3a5a40";
      context.font = `600 16px ${fontFamily}`;
      context.fillText("TRIPBOOGIE  /  일정 한눈에 보기", padding, 30);
      context.font = `600 30px ${fontFamily}`;
      let heading = title;
      while (context.measureText(heading).width > width - padding * 2 && heading.length > 1) heading = Array.from(heading).slice(0, -2).join("") + "…";
      context.fillStyle = "#1a1d1e";
      context.fillText(heading, padding, 65);
      context.font = `17px ${fontFamily}`;
      context.fillStyle = "#5e6b63";
      context.fillText(`${shortDate(rows[0].date)} — ${shortDate(rows[rows.length - 1].date)}  ·  각 장소의 현지 시각`, padding, 110);
      context.fillStyle = "#edf3eb";
      context.fillRect(padding, 144, width - padding * 2, 44);
      context.fillStyle = "#3a5a40";
      context.font = `600 18px ${fontFamily}`;
      context.fillText("날짜", padding + 18, 157);
      context.fillText("일정", padding + dateWidth + 22, 157);
      let y = headerHeight;
      for (const segment of segments) {
        const rowHeight = segment.lines.length * lineHeight + rowPadding;
        context.fillStyle = "#f8faf7";
        context.fillRect(padding, y, dateWidth, rowHeight);
        context.fillStyle = "#3a5a40";
        context.font = `600 20px ${fontFamily}`;
        context.fillText(shortDate(segment.date), padding + 18, y + 20);
        if (segment.continued) { context.font = `16px ${fontFamily}`; context.fillText("계속", padding + 18, y + 44); }
        context.fillStyle = "#1a1d1e";
        context.font = `20px ${fontFamily}`;
        segment.lines.forEach((line, i) => context.fillText(line, padding + dateWidth + 22, y + 18 + i * lineHeight));
        context.strokeStyle = "#dce4d9";
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(padding, y + rowHeight); context.lineTo(width - padding, y + rowHeight); context.stroke();
        y += rowHeight;
      }
      context.fillStyle = "#5e6b63";
      context.font = `15px ${fontFamily}`;
      context.fillText("느긋하게, 함께. 트립부기", padding, height - 35);
      context.textAlign = "right";
      context.fillText(`${index + 1} / ${pages.length}`, width - padding, height - 35);
      context.textAlign = "left";
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("이미지를 만들지 못했어요. 날짜 범위를 줄여 다시 시도해 주세요.")), "image/png"));
      images.push({ blob, width: canvas.width, height: canvas.height });
      onProgress?.(images.length, pages.length);
    }
    return images;
  } finally {
    // Release the backing bitmap after both successful exports and failed encodes.
    canvas.width = canvas.height = 0;
  }
}
