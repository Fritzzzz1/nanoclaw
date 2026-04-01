/**
 * Default file handler — tries skill extractors, falls back to default.
 *
 * Skill implementations listed here:
 *   - pdf-extract: text extraction via pdftotext (poppler-utils)
 */
import { extractPdf } from './pdf-extract.js';

export async function handleFile(filePath: string): Promise<any[] | null> {
  const pdfResult = await extractPdf(filePath);
  if (pdfResult) return pdfResult;

  return null;
}
