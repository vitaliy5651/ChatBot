import { NextResponse, type NextRequest } from "next/server";

import { getUserIdFromRequest } from "@/shared/api/supabaseAdmin";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_CHARS = 60_000;

async function extractPdfTextViaSpawn(buf: Buffer): Promise<string> {
  const { spawn } = await import("node:child_process");
  const code = `
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const buf = Buffer.concat(chunks);

const loadingTask = getDocument({ data: new Uint8Array(buf) });
const doc = await loadingTask.promise;

const out = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const items = Array.isArray(content?.items) ? content.items : [];
  out.push(items.map((it) => (typeof it?.str === "string" ? it.str : "")).filter(Boolean).join(" "));
}

try { await loadingTask.destroy?.(); } catch {}
try { await doc.destroy?.(); } catch {}

process.stdout.write(JSON.stringify({ text: out.join("\\n") }));
`;

  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (d) => stdout.push(Buffer.from(d)));
  child.stderr.on("data", (d) => stderr.push(Buffer.from(d)));
  child.stdin.on("error", () => {
    // ignore EPIPE if child exits early
  });

  child.stdin.write(buf);
  child.stdin.end();

  const exitCode: number = await new Promise((resolve) => child.on("close", resolve));
  if (exitCode !== 0) {
    const errText = Buffer.concat(stderr).toString("utf8").slice(0, 2000);
    throw new Error(errText || "PDF extract failed");
  }

  const raw = Buffer.concat(stdout).toString("utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed?.text === "string" ? parsed.text : "";
}

async function extractPdfTextInProcess(buf: Buffer): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask: any = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const doc: any = await loadingTask.promise;

  const out: string[] = [];
  const numPages = Number(doc?.numPages ?? 0);
  for (let i = 1; i <= numPages; i++) {
    const page: any = await doc.getPage(i);
    const content: any = await page.getTextContent();
    const items: any[] = Array.isArray(content?.items) ? content.items : [];
    out.push(
      items
        .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
        .filter(Boolean)
        .join(" "),
    );
  }

  try {
    await loadingTask.destroy?.();
  } catch {
    // ignore
  }
  try {
    await doc.destroy?.();
  } catch {
    // ignore
  }

  return out.join("\n");
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // In Next dev, importing pdfjs inside route can throw "Object.defineProperty called on non-object".
  // Prefer in-process parsing; on failure, fall back to a plain Node subprocess in development.
  try {
    return await extractPdfTextInProcess(buf);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      return await extractPdfTextViaSpawn(buf);
    }
    throw e;
  }
}

function truncate(text: string) {
  const clean = text.replace(/\u0000/g, "").trim();
  if (clean.length <= MAX_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_CHARS), truncated: true };
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const url = typeof body?.url === "string" ? body.url : "";
    const fileType = typeof body?.fileType === "string" ? body.fileType : "";

    if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: "Failed to fetch file" }, { status: 400 });

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "File is too large" }, { status: 413 });

    let text = "";

    if (fileType === "application/pdf" || url.toLowerCase().includes(".pdf")) {
      text = await extractPdfText(buf);
    } else if (
      fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      url.toLowerCase().includes(".docx")
    ) {
      const mammoth: any = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value ?? "";
    } else if (fileType.startsWith("text/") || url.toLowerCase().match(/\.(txt|md|markdown)$/)) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json(
        { error: "Unsupported document type. Use .txt/.md/.pdf/.docx" },
        { status: 415 },
      );
    }

    const out = truncate(text);
    return NextResponse.json({ content: out.text, truncated: out.truncated });
  } catch (e: any) {
    console.error("/api/documents/extract failed:", e);
    return NextResponse.json({ error: e?.message ?? "Extract failed" }, { status: 500 });
  }
}

