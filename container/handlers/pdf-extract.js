/**
 * PDF text extraction handler — poppler-utils (pdftotext).
 * Priority 50 (default). Falls through if pdftotext not installed or extraction fails.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function log(msg) {
  console.error(`[pdf-extract] ${msg}`);
}

async function handler(filePath) {
  log(`Called with filePath="${filePath}"`);

  // Only handle PDF files
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') {
    log(`Skipping: extension is "${ext}", not .pdf`);
    return null;
  }

  if (!fs.existsSync(filePath)) {
    log(`Skipping: file does not exist`);
    return null;
  }

  const fileSize = fs.statSync(filePath).size;
  log(`File exists, size=${fileSize} bytes`);

  try {
    execSync('which pdftotext', { stdio: 'ignore' });
    log(`pdftotext found`);
  } catch {
    log(`pdftotext NOT found, falling through to default`);
    return null;
  }

  try {
    // Get page count via pdfinfo
    let pages = null;
    try {
      const info = execSync(`pdfinfo "${filePath}" 2>/dev/null`, { encoding: 'utf-8' });
      const pagesMatch = info.match(/Pages:\s+(\d+)/);
      pages = pagesMatch ? parseInt(pagesMatch[1]) : null;
      log(`pdfinfo: ${pages} pages`);
    } catch (e) {
      log(`pdfinfo failed: ${e.message}`);
    }

    // Extract text with layout preservation
    const text = execSync(`pdftotext -layout "${filePath}" -`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }).trim();

    log(`pdftotext result: ${text.length} chars`);
    if (text.length > 0) {
      log(`First 200 chars: ${text.slice(0, 200)}`);
    }

    if (!text) {
      log(`Empty extraction, falling through to default`);
      return null;
    }

    const filename = path.basename(filePath);
    const pageSuffix = pages ? ` — ${pages} pages` : '';
    const header = `[PDF "${filename}"${pageSuffix}. Auto-extracted by pdf-reader skill. File available at ${filePath}]:`;

    const result = [{ type: 'text', text: `${header}\n\n${text}` }];
    log(`Returning text result (${result[0].text.length} chars)`);
    return result;
  } catch (e) {
    log(`Extraction failed: ${e.message}`);
    return null;
  }
}

export default [
  { type: 'file', priority: 50, handler },
];
