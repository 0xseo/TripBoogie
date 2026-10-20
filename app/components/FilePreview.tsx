"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { pdfBrowserError } from "../pdf-preview-support";
import { getSupabaseClient } from "../client-api";
import { readDocumentPreview, type DocumentPreview } from "../document-preview";
import type { TripFile } from "../types";
import { Dialog } from "./ui";
import type { PDFDocumentProxy } from "pdfjs-dist";
function PDFPages({ document: pdf }: { document: PDFDocumentProxy }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [renderState, setRenderState] = useState({ key: "", error: "" });
  const renderKey = `${pdf.fingerprints[0]}:${page}:${zoom}`,
    rendering = renderState.key !== renderKey,
    error = renderState.key === renderKey ? renderState.error : "";
  useEffect(() => {
    let active = true,
      task:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
        | undefined;
    void pdf
      .getPage(page)
      .then((p) => {
        if (!active || !canvas.current) return;
        const natural = p.getViewport({ scale: 1 }),
          width = Math.max(200, (host.current?.clientWidth || 320) - 24),
          scale = Math.min(2, devicePixelRatio || 1),
          viewport = p.getViewport({ scale: (width / natural.width) * zoom });
        const c = canvas.current;
        c.width = Math.ceil(viewport.width * scale);
        c.height = Math.ceil(viewport.height * scale);
        c.style.width = `${viewport.width}px`;
        c.style.height = `${viewport.height}px`;
        task = p.render({
          canvas: c,
          viewport,
          transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0],
        });
        return task.promise;
      })
      .then(() => {
        if (active) {
          setRenderState({ key: renderKey, error: "" });
        }
      })
      .catch((e) => {
        if (active) {
          setRenderState({ key: renderKey, error: e.message });
        }
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page, zoom, renderKey]);
  return (
    <>
      <div className="preview-toolbar">
        <button
          type="button"
          className="icon"
          aria-label="이전 페이지"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft />
        </button>
        <span>
          {page} / {pdf.numPages}
        </span>
        <button
          type="button"
          className="icon"
          aria-label="다음 페이지"
          disabled={page === pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight />
        </button>
        <button
          type="button"
          className="icon"
          aria-label="축소"
          disabled={zoom <= 0.75}
          onClick={() => setZoom((z) => z - 0.25)}
        >
          <ZoomOut />
        </button>
        <button
          type="button"
          className="icon"
          aria-label="확대"
          disabled={zoom >= 2}
          onClick={() => setZoom((z) => z + 0.25)}
        >
          <ZoomIn />
        </button>
      </div>
      {rendering && <p role="status">페이지를 읽는 중…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-pages" ref={host}>
        <canvas ref={canvas} aria-label={`PDF ${page}페이지`} />
      </div>
    </>
  );
}
export default function FilePreview({
  file,
  onClose,
  load,
}: {
  file: TripFile;
  onClose: () => void;
  load?: (file: TripFile) => Promise<Blob>;
}) {
  const [state, setState] = useState<{
      url?: string;
      pdf?: PDFDocumentProxy;
      document?: DocumentPreview;
    } | null>(null),
    [error, setError] = useState(""),
    [sheet, setSheet] = useState(0);
  useEffect(() => {
    let active = true,
      loadTimer: ReturnType<typeof setTimeout> | undefined,
      url: string | undefined,
      pdf: PDFDocumentProxy | undefined,
      task: { destroy: () => Promise<void> } | undefined;
    void (async () => {
      let blob: Blob;
      if (load) blob = await load(file);
      else {
        const client = await getSupabaseClient();
        if (!client) throw new Error("로그인을 확인해 주세요.");
        const response = await client.storage
          .from("tripboogie-private")
          .download(file.path);
        if (response.error || !response.data)
          throw new Error("파일을 불러오지 못했어요.");
        blob = response.data;
      }
      if (!active) return;
      const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
      if (file.mime.startsWith("image/")) {
        url = URL.createObjectURL(blob);
        setState({ url });
      } else if (file.mime === "application/pdf" || extension === "pdf") {
        const unsupported = pdfBrowserError(navigator.userAgent);
        if (unsupported) throw new Error(unsupported);
        const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        lib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js";
        const request = lib.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        });
        task = request;
        try {
          pdf = await Promise.race([
            request.promise,
            new Promise<never>((_, reject) => {
              loadTimer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "PDF를 읽는 데 시간이 오래 걸리고 있어요. 다시 열거나 파일을 다운로드해서 확인해 주세요.",
                    ),
                  ),
                20000,
              );
            }),
          ]);
        } catch (e) {
          void request.destroy().catch(() => {});
          throw e;
        } finally {
          clearTimeout(loadTimer);
        }
        if (active) setState({ pdf });
        else await request.destroy();
      } else if (["docx", "xlsx", "txt"].includes(extension)) {
        const document = readDocumentPreview(
          new Uint8Array(await blob.arrayBuffer()),
          extension,
        );
        if (active) setState({ document });
      } else throw new Error("이 파일 형식은 미리보기를 지원하지 않아요.");
    })().catch((e) => {
      if (active)
        setError(
          e.name === "PasswordException"
            ? "암호로 보호된 PDF는 다운로드해서 확인해 주세요."
            : e.message,
        );
    });
    return () => {
      active = false;
      clearTimeout(loadTimer);
      if (url) URL.revokeObjectURL(url);
      if (task) void task.destroy();
    };
  }, [file, load]);
  const doc = state?.document;
  return (
    <Dialog mobilePage wide title={file.name} onClose={onClose}>
      <section className="file-preview">
        {!state && !error && (
          <div className="preview-loading" role="status">
            <LoaderCircle className="spinner" />
            미리보기 준비 중…
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {state?.url && (
          <Image
            src={state.url}
            alt={file.name}
            width={1600}
            height={1200}
            unoptimized
            className="preview-image"
          />
        )}
        {state?.pdf && <PDFPages document={state.pdf} />}{" "}
        {doc?.kind === "text" && (
          <>
            {doc.truncated && (
              <p className="info">긴 문서의 앞부분을 표시하고 있어요.</p>
            )}
            <pre className="preview-text">
              {doc.text || "표시할 텍스트가 없어요."}
            </pre>
          </>
        )}
        {doc?.kind === "sheets" && (
          <>
            <nav className="preview-sheet-tabs">
              {doc.sheets.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  aria-pressed={sheet === i}
                  onClick={() => setSheet(i)}
                >
                  {s.name}
                </button>
              ))}
            </nav>
            {doc.sheets[sheet]?.truncated && (
              <p className="info">각 시트의 처음 300행·50열을 표시해요.</p>
            )}
            <div className="preview-sheet">
              <table>
                <tbody>
                  {doc.sheets[sheet]?.rows.map((row, i) => (
                    <tr key={i}>
                      <th>{i + 1}</th>
                      {row.map((value, j) => (
                        <td key={j}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </Dialog>
  );
}
