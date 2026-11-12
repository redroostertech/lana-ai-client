import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserWindowConstructorOptions, PrintToPDFOptions } from "electron";

/** The client's print assets (files under public_html): the stylesheets and the LANA logo. */
export interface ExportAssets {
  /** briefs-export-print.css: the page. Its fonts load relative to it. */
  readonly stylesheet: string;
  /** briefs-export-footer.css: the page footer, which Chromium renders apart from the page. */
  readonly footerStylesheet: string;
  /** The LANA logo for light paper. */
  readonly logo: string;
}

/** The part of an Electron BrowserWindow the renderer uses. */
export interface PrintWindow {
  readonly webContents: {
    loadFile(path: string): Promise<void>;
    printToPDF(options: PrintToPDFOptions): Promise<Uint8Array>;
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): unknown;
  };
  destroy(): void;
  isDestroyed(): boolean;
}

export type PrintWindowFactory = (options: BrowserWindowConstructorOptions) => PrintWindow;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The whole page around an export's body: the print stylesheet and the LANA mark, with a
 * policy that lets the page load only local files (no network, no scripts).
 */
export function exportDocument(body: string, title: string, assets: ExportAssets): string {
  const stylesheet = pathToFileURL(assets.stylesheet).href;
  const logo = pathToFileURL(assets.logo).href;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src file:; font-src file:; img-src file:">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(stylesheet)}">
</head>
<body class="ex-page">
<div class="ex-brand"><img class="ex-logo" src="${escapeHtml(logo)}" alt="LANA AI"><span class="ex-brand-product">Briefs</span></div>
${body}
</body>
</html>`;
}

/** The footer on every page: the product, the meeting title and "Page 2 of 5". */
export function footerTemplate(title: string, css: string): string {
  return `<style>${css}</style><div class="exf"><span class="exf-brand">LANA Briefs</span><span class="exf-title">${escapeHtml(title)}</span><span class="exf-page">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

/**
 * Prints an export to PDF through Chromium: the page goes to a private temporary folder,
 * opens in a hidden window with scripts off and no network, prints to US Letter with page
 * numbers, and the window and folder are removed at once.
 */
export function createPdfRenderer(options: { readonly createWindow: PrintWindowFactory; readonly assets: ExportAssets; readonly tempRoot?: string }) {
  const { assets } = options;
  return async (document: { body: string; title: string }): Promise<Uint8Array> => {
    const directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), "lana-export-"));
    let window: PrintWindow | null = null;
    try {
      const page = join(directory, "export.html");
      await writeFile(page, exportDocument(document.body, document.title, assets), { mode: 0o600 });
      const footerCss = await readFile(assets.footerStylesheet, "utf8");
      window = options.createWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "lana-briefs-export", spellcheck: false },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      await window.webContents.loadFile(page);
      return await window.webContents.printToPDF({
        pageSize: "Letter",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: footerTemplate(document.title, footerCss),
        margins: { top: 0.7, bottom: 0.75, left: 0.8, right: 0.8 },
      });
    } finally {
      if (window !== null && !window.isDestroyed()) window.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  };
}
