import { unzipSync, strFromU8 } from "fflate";
export type DocumentPreview =
  | { kind: "text"; text: string; truncated: boolean }
  | {
      kind: "sheets";
      sheets: { name: string; rows: string[][]; truncated: boolean }[];
    };
const limit = 8 * 1024 * 1024;
function xml(bytes: Uint8Array | undefined) {
  if (!bytes) throw new Error("문서 내용을 찾지 못했어요.");
  const doc = new DOMParser().parseFromString(
    strFromU8(bytes),
    "application/xml",
  );
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("문서 형식을 읽지 못했어요.");
  return doc;
}
const elements = (node: Document | Element, name: string) =>
  Array.from(node.getElementsByTagNameNS("*", name));
export function readDocumentPreview(
  bytes: Uint8Array,
  extension: string,
): DocumentPreview {
  if (extension === "txt") {
    let text: string;
    if (bytes[0] === 255 && bytes[1] === 254)
      text = new TextDecoder("utf-16le").decode(bytes);
    else if (bytes[0] === 254 && bytes[1] === 255)
      text = new TextDecoder("utf-16be").decode(bytes);
    else
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("euc-kr").decode(bytes);
      }
    return {
      kind: "text",
      text: text.slice(0, 1000000),
      truncated: text.length > 1000000,
    };
  }
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (
        !/^(word\/document\.xml|xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|worksheets\/[a-zA-Z0-9_-]+\.xml))$/.test(
          entry.name,
        )
      )
        return false;
      total += entry.originalSize;
      if (entry.originalSize > limit || total > 24 * 1024 * 1024)
        throw new Error("내용이 큰 문서는 다운로드해서 확인해 주세요.");
      return true;
    },
  });
  if (extension === "docx") {
    const text = elements(xml(files["word/document.xml"]), "p")
      .map((p) =>
        elements(p, "t")
          .map((t) => t.textContent || "")
          .join(""),
      )
      .join("\n");
    return {
      kind: "text",
      text: text.slice(0, 1000000),
      truncated: text.length > 1000000,
    };
  }
  const shared = files["xl/sharedStrings.xml"]
    ? elements(xml(files["xl/sharedStrings.xml"]), "si").map((p) =>
        elements(p, "t")
          .map((t) => t.textContent)
          .join(""),
      )
    : [];
  const relationships = elements(
    xml(files["xl/_rels/workbook.xml.rels"]),
    "Relationship",
  );
  const workbook = xml(files["xl/workbook.xml"]),
    date1904 = ["1", "true"].includes(
      elements(workbook, "workbookPr")[0]?.getAttribute("date1904") || "",
    ),
    styles = files["xl/styles.xml"] ? xml(files["xl/styles.xml"]) : undefined;
  const custom = new Map(
      styles
        ? elements(styles, "numFmt").map((f) => [
            Number(f.getAttribute("numFmtId")),
            f.getAttribute("formatCode") || "",
          ])
        : [],
    ),
    formats = styles ? elements(styles, "cellXfs")[0] : undefined;
  const numberFormats = formats
    ? elements(formats, "xf").map((f) => Number(f.getAttribute("numFmtId")))
    : [];
  function formatted(cell: Element, value: string) {
    const formatId = numberFormats[Number(cell.getAttribute("s") || 0)] || 0,
      format = (custom.get(formatId) || "").replace(
        /"[^"]*"|\\.|\[[^\]]*\]/g,
        "",
      );
    const isDate =
        (formatId >= 14 && formatId <= 17) ||
        formatId === 22 ||
        /(^|[^a-z])[yd]+|m{2,4}/i.test(format),
      isTime =
        (formatId >= 18 && formatId <= 22) ||
        /h{1,2}:m{1,2}|m{1,2}:s{1,2}/i.test(format),
      serial = Number(value);
    if (
      (!isDate && !isTime) ||
      value === "" ||
      !Number.isFinite(serial) ||
      serial < 0 ||
      serial > 2958465
    )
      return value;
    const date = new Date(
      (date1904
        ? Date.UTC(1904, 0, 1)
        : Date.UTC(1899, 11, serial < 60 ? 31 : 30)) +
        Math.round(serial * 86400000),
    );
    return [
      isDate
        ? !date1904 && Math.floor(serial) === 60
          ? "1900-02-29"
          : date.toISOString().slice(0, 10)
        : "",
      isTime ? date.toISOString().slice(11, 19) : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return {
    kind: "sheets",
    sheets: elements(workbook, "sheet")
      .slice(0, 20)
      .map((sheet, index) => {
        const rel = relationships.find(
          (r) => r.getAttribute("Id") === sheet.getAttribute("r:id"),
        );
        const target =
          rel?.getAttribute("Target") || `worksheets/sheet${index + 1}.xml`;
        const path = target.startsWith("/xl/")
          ? target.slice(1)
          : `xl/${target}`;
        if (!/^xl\/worksheets\/[a-zA-Z0-9_-]+\.xml$/.test(path))
          throw new Error("이 시트 형식은 미리보기를 지원하지 않아요.");
        const rows = elements(xml(files[path]), "row"),
          truncated =
            rows.length > 300 || rows.some((r) => elements(r, "c").length > 50);
        return {
          name: sheet.getAttribute("name") || `시트 ${index + 1}`,
          truncated,
          rows: rows.slice(0, 300).map((row) => {
            const cells: string[] = [];
            for (const cell of elements(row, "c")) {
              const ref = cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0];
              let column = 0;
              for (const char of ref || "")
                column = column * 26 + char.charCodeAt(0) - 64;
              const i = ref ? column - 1 : cells.length;
              if (i >= 50) continue;
              const type = cell.getAttribute("t"),
                value = elements(cell, "v")[0]?.textContent || "";
              cells[i] =
                type === "s"
                  ? shared[Number(value)] || ""
                  : type === "inlineStr"
                    ? elements(cell, "t")
                        .map((t) => t.textContent)
                        .join("")
                    : type === "b"
                      ? value === "1"
                        ? "TRUE"
                        : "FALSE"
                      : formatted(cell, value);
            }
            return Array.from(
              { length: cells.length },
              (_, i) => cells[i] || "",
            );
          }),
        };
      }),
  };
}
