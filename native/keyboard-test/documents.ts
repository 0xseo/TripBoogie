// Self-authored, tiny documents for the real browser/WebView preview regression tests.
import { zipSync, strToU8 } from "fflate";
import { readDocumentPreview } from "../../app/document-preview";
const zip = (files: Record<string, string>) =>
  zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  );
export const docx = zip({
  "word/document.xml":
    '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>여행 예약 확인</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>',
});
export const xlsx = zip({
  "xl/workbook.xml":
    '<workbook xmlns:r="urn:rels"><sheets><sheet name="여행 경비" r:id="r1"/><sheet name="날짜" r:id="r2"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<Relationships><Relationship Id="r1" Target="worksheets/budget.xml"/><Relationship Id="r2" Target="/xl/worksheets/dates.xml"/></Relationships>',
  "xl/sharedStrings.xml": "<sst><si><t>오클랜드</t></si></sst>",
  "xl/styles.xml":
    '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="22"/></cellXfs></styleSheet>',
  "xl/worksheets/budget.xml":
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+1</f><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>&lt;img onerror=alert(1)&gt;</t></is></c><c r="B2" t="b"><v>1</v></c></row></sheetData></worksheet>',
  "xl/worksheets/dates.xml":
    '<worksheet><sheetData><row><c r="A1" s="1"><v>45292</v></c><c r="B1" s="2"><v>45292.5</v></c><c r="C1" s="1"><v>60</v></c></row></sheetData></worksheet>',
});
function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["TripBoogie preview page 1", "TripBoogie preview page 2"].map(
      (text) => {
        const stream = `BT /F1 16 Tf 20 160 Td (${text}) Tj ET`;
        return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      },
    ),
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}
export const previewBlob = (extension: string) =>
  new Blob(
    [
      Uint8Array.from(
        extension === "pdf"
          ? pdf()
          : extension === "docx"
            ? docx
            : extension === "xlsx"
              ? xlsx
              : extension === "png"
                ? Uint8Array.from(
                    atob(
                      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xkAAAAASUVORK5CYII=",
                    ),
                    (c) => c.charCodeAt(0),
                  )
                : strToU8("뉴질랜드 여행 자료\n숙소 주소와 예약 메모"),
      ),
    ],
    {
      type:
        extension === "png"
          ? "image/png"
          : extension === "pdf"
            ? "application/pdf"
            : "application/octet-stream",
    },
  );
export function auditDocuments() {
  const results: Record<string, boolean> = {};
  const word = readDocumentPreview(docx, "docx");
  results.docx =
    word.kind === "text" &&
    word.text === "여행 예약 확인\n<script>alert(1)</script>";
  const sheet = readDocumentPreview(xlsx, "xlsx");
  results.xlsx =
    sheet.kind === "sheets" &&
    sheet.sheets.length === 2 &&
    JSON.stringify(sheet.sheets[0].rows[0]) === '["오클랜드","","2"]' &&
    sheet.sheets[1].rows[0].join("|") ===
      "2024-01-01|2024-01-01 12:00:00|1900-02-29";
  const utf16 = readDocumentPreview(
    new Uint8Array([255, 254, 129, 189]),
    "txt",
  );
  results.utf16 = utf16.kind === "text" && utf16.text === "북";
  const large = readDocumentPreview(strToU8("a".repeat(1000001)), "txt");
  results.truncation =
    large.kind === "text" && large.truncated && large.text.length === 1000000;
  try {
    readDocumentPreview(
      zip({ "word/document.xml": "x".repeat(8 * 1024 * 1024 + 1) }),
      "docx",
    );
    results.zipLimit = false;
  } catch {
    results.zipLimit = true;
  }
  try {
    readDocumentPreview(zip({ "word/document.xml": "<broken" }), "docx");
    results.invalidXml = false;
  } catch {
    results.invalidXml = true;
  }
  return { pass: Object.values(results).every(Boolean), results };
}
