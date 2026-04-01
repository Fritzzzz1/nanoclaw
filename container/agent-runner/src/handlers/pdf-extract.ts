/**
 * PDF text extraction — poppler-utils (pdftotext).
 * Returns null if not a PDF, pdftotext not installed, or extraction fails.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function extractPdf(filePath: string): Promise<any[] | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') return null;
  if (!fs.existsSync(filePath)) return null;

  try {
    execSync('which pdftotext', { stdio: 'ignore' });
  } catch {
    return null;
  }

  try {
    let pages: number | null = null;
    try {
      const info = execSync(`pdfinfo "${filePath}" 2>/dev/null`, {
        encoding: 'utf-8',
      });
      const match = info.match(/Pages:\s+(\d+)/);
      pages = match ? parseInt(match[1]) : null;
    } catch {
      /* pdfinfo optional */
    }

    const text = execSync(`pdftotext -layout "${filePath}" -`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();

    if (!text) return null;

    const filename = path.basename(filePath);
    const pageSuffix = pages ? ` — ${pages} pages` : '';
    const header = `[PDF "${filename}"${pageSuffix}. File available at ${filePath}]:`;

    return [{ type: 'text', text: `${header}\n\n${text}` }];
  } catch {
    return null;
  }
}
