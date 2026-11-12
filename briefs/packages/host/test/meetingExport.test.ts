import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioExtension, audioPartPath, MeetingExportService, safeFileName, type ExportFiles } from "../src/main/services/meetingExportService.js";
import { createPdfRenderer, exportDocument, footerTemplate, type PrintWindow } from "../src/main/services/pdfRenderer.js";
import { makeLanaId } from "@lana/core/ids";
import type { MainLog } from "../src/main/log.js";
import type { MeetingExportRequest } from "../src/shared/api.js";

const MEETING = makeLanaId("meeting");
let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "briefs-export-"));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function fakeLog() {
  const lines: Array<{ event: string; fields?: unknown }> = [];
  const push = (event: string, fields?: unknown) => {
    lines.push({ event, fields });
  };
  const log = { info: push, warn: push, error: push, path: folder } as unknown as MainLog;
  return { log, lines };
}

function fakeFiles(picked: string | null) {
  const files = {
    pickPath: vi.fn(async () => picked),
    renderPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    showItemInFolder: vi.fn(),
  } satisfies ExportFiles;
  return files;
}

function audioSource(parts: Array<{ name: string; data: number[] }>) {
  return {
    audioParts: vi.fn(() => parts.map((part, index) => ({ index, name: part.name, byteCount: part.data.length }))),
    audioData: vi.fn((_id: unknown, index: number) => new Uint8Array(parts[index]!.data)),
  };
}

const request = (overrides: Partial<MeetingExportRequest> = {}): MeetingExportRequest => ({
  meetingID: MEETING,
  kind: "transcriptPdf",
  fileName: "Annapolis 2026-11-10 Transcript",
  title: "Annapolis",
  content: "<h1>Annapolis</h1>",
  ...overrides,
});

describe("MeetingExportService", () => {
  it("prints a PDF after the save dialog, writes it privately and shows it in the folder", async () => {
    const target = join(folder, "out.pdf");
    const files = fakeFiles(target);
    const { log, lines } = fakeLog();
    const service = new MeetingExportService(audioSource([]), files, log);
    const result = await service.save(request());
    expect(result).toEqual({ ok: true, value: { fileID: expect.stringMatching(/^[0-9a-f]{24}$/), files: 1 } });
    expect(files.pickPath).toHaveBeenCalledWith("Annapolis 2026-11-10 Transcript.pdf", { name: "PDF", extensions: ["pdf"] });
    expect(files.renderPdf).toHaveBeenCalledWith({ body: "<h1>Annapolis</h1>", title: "Annapolis" });
    expect(readFileSync(target).toString()).toBe("%PDF");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    if (!result.ok || result.value === null) throw new Error("not saved");
    await service.showInFolder(result.value.fileID);
    expect(files.showItemInFolder).toHaveBeenCalledWith(target);
    await service.showInFolder("unknown");
    expect(files.showItemInFolder).toHaveBeenCalledTimes(1);
    // Ids, kinds and sizes only: never the title, the content or the path.
    expect(JSON.stringify(lines)).not.toMatch(/Annapolis|out\.pdf|<h1>/);
    expect(lines.at(-1)).toEqual({ event: "export.saved", fields: { meeting: MEETING, kind: "transcriptPdf", bytes: 4 } });
  });

  it("writes plain text as is, with a .txt name", async () => {
    const target = join(folder, "out.txt");
    const files = fakeFiles(target);
    const service = new MeetingExportService(audioSource([]), files, fakeLog().log);
    await service.save(request({ kind: "transcriptText", content: "[0:04] Ana: hello\n" }));
    expect(files.pickPath).toHaveBeenCalledWith("Annapolis 2026-11-10 Transcript.txt", { name: "Plain text", extensions: ["txt"] });
    expect(files.renderPdf).not.toHaveBeenCalled();
    expect(readFileSync(target, "utf8")).toBe("[0:04] Ana: hello\n");
  });

  it("a cancelled dialog saves nothing and prints nothing", async () => {
    const files = fakeFiles(null);
    const service = new MeetingExportService(audioSource([]), files, fakeLog().log);
    expect(await service.save(request())).toEqual({ ok: true, value: null });
    expect(files.renderPdf).not.toHaveBeenCalled();
    expect(readdirSync(folder)).toEqual([]);
  });

  it("refuses bad requests before asking where to save", async () => {
    const files = fakeFiles(join(folder, "x"));
    const service = new MeetingExportService(audioSource([]), files, fakeLog().log);
    for (const bad of [request({ meetingID: "nope" }), request({ kind: "docx" as never }), request({ content: undefined as never }), request({ content: "x".repeat(32 * 1024 * 1024 + 1) })]) {
      expect(await service.save(bad)).toEqual({ ok: false, error: { code: "invalid", message: "LANA could not export this meeting." } });
    }
    expect(files.pickPath).not.toHaveBeenCalled();
  });

  it("a failed print or write is an error the person can read", async () => {
    const files = fakeFiles(join(folder, "out.pdf"));
    files.renderPdf.mockRejectedValueOnce(new Error("boom"));
    const { log, lines } = fakeLog();
    const service = new MeetingExportService(audioSource([]), files, log);
    expect(await service.save(request())).toEqual({ ok: false, error: { code: "io", message: "LANA could not save the export. Try again." } });
    expect(lines.at(-1)?.event).toBe("export.render_failed");
    const failing = new MeetingExportService(audioSource([]), fakeFiles(join(folder, "out.pdf")), log, async () => {
      throw new Error("disk full");
    });
    expect((await failing.save(request())).ok).toBe(false);
  });

  it("saves one audio part under the picked name with its own extension", async () => {
    const target = join(folder, "Annapolis Audio.m4a");
    const files = fakeFiles(target);
    const service = new MeetingExportService(audioSource([{ name: "audio/seg-0000.m4a", data: [1, 2, 3] }]), files, fakeLog().log);
    const result = await service.save(request({ kind: "audio", fileName: "Annapolis 2026-11-10 Audio", content: undefined as never }));
    expect(result).toEqual({ ok: true, value: { fileID: expect.any(String), files: 1 } });
    expect(files.pickPath).toHaveBeenCalledWith("Annapolis 2026-11-10 Audio.m4a", { name: "Audio", extensions: ["m4a"] });
    expect([...readFileSync(target)]).toEqual([1, 2, 3]);
  });

  it("saves audio stored in several parts side by side, numbered", async () => {
    const files = fakeFiles(join(folder, "Annapolis Audio.m4a"));
    const service = new MeetingExportService(audioSource([{ name: "seg-0000.m4a", data: [1] }, { name: "seg-0001.m4a", data: [2] }]), files, fakeLog().log);
    const result = await service.save(request({ kind: "audio" }));
    expect(result.ok && result.value?.files).toBe(2);
    expect(readdirSync(folder).sort()).toEqual(["Annapolis Audio part 1 of 2.m4a", "Annapolis Audio part 2 of 2.m4a"]);
  });

  it("no audio left: says so without a dialog", async () => {
    const files = fakeFiles(join(folder, "a.m4a"));
    const service = new MeetingExportService(audioSource([]), files, fakeLog().log);
    expect(await service.save(request({ kind: "audio" }))).toEqual({ ok: false, error: { code: "noAudio", message: "The audio for this meeting is no longer on this computer." } });
    expect(files.pickPath).not.toHaveBeenCalled();
  });

  it("names: safe, extension kept or defaulted, parts numbered", () => {
    expect(safeFileName("../../etc/passwd")).toBe("etc passwd");
    expect(safeFileName(' a:b*c?"d<e>|f ')).toBe("a b c d e f");
    expect(safeFileName("...")).toBe("Meeting");
    expect(safeFileName("x".repeat(300))).toHaveLength(120);
    expect(audioExtension("seg-0001.WAV")).toBe("wav");
    expect(audioExtension("seg-0001.bin")).toBe("m4a");
    expect(audioPartPath("/a/b.m4a", 1, 1, "m4a")).toBe("/a/b.m4a");
    expect(audioPartPath("/a/b.m4a", 2, 3, "caf")).toBe(join("/a", "b part 2 of 3.caf"));
  });
});

describe("pdfRenderer", () => {
  const assets = () => ({ stylesheet: join(folder, "print.css"), footerStylesheet: join(folder, "footer.css"), logo: join(folder, "logo.png") });

  it("wraps the body with the stylesheet, the logo and a local-only policy", () => {
    const html = exportDocument("<p>Body</p>", "A <b>title</b>", assets());
    expect(html).toContain(`<link rel="stylesheet" href="file://${join(folder, "print.css")}">`);
    expect(html).toContain('<img class="ex-logo" src="file://');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<title>A &lt;b&gt;title&lt;/b&gt;</title>");
    expect(html).toContain("<p>Body</p>");
    expect(footerTemplate("Q&A <x>", ".exf{}")).toContain('<span class="exf-title">Q&amp;A &lt;x&gt;</span>');
    expect(footerTemplate("t", ".exf{}")).toContain('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
  });

  it("prints in a hidden window with scripts off, then removes the window and the page", async () => {
    writeFileSync(join(folder, "footer.css"), ".exf { color: red; }");
    const temp = mkdtempSync(join(tmpdir(), "briefs-print-"));
    let loaded = "";
    const window = {
      webContents: {
        loadFile: vi.fn(async (path: string) => {
          loaded = path;
          expect(readFileSync(path, "utf8")).toContain("<p>Body</p>");
        }),
        printToPDF: vi.fn(async (_options: unknown) => new Uint8Array([7])),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
      },
      destroy: vi.fn(),
      isDestroyed: () => false,
    } satisfies PrintWindow;
    const createWindow = vi.fn((_options: unknown) => window);
    const render = createPdfRenderer({ createWindow, assets: assets(), tempRoot: temp });
    expect([...(await render({ body: "<p>Body</p>", title: "Annapolis" }))]).toEqual([7]);
    expect(createWindow.mock.calls[0]![0]).toEqual(expect.objectContaining({ show: false, webPreferences: expect.objectContaining({ javascript: false, sandbox: true, nodeIntegration: false }) }));
    const options = window.webContents.printToPDF.mock.calls[0]![0] as unknown as { pageSize: string; displayHeaderFooter: boolean; footerTemplate: string };
    expect(options.pageSize).toBe("Letter");
    expect(options.displayHeaderFooter).toBe(true);
    expect(options.footerTemplate).toContain(".exf { color: red; }");
    expect(window.destroy).toHaveBeenCalled();
    expect(existsSync(loaded)).toBe(false);
    expect(readdirSync(temp)).toEqual([]);
    rmSync(temp, { recursive: true, force: true });
  });
});
