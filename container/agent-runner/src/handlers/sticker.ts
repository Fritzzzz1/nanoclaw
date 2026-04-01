/**
 * Default sticker handler — no native Claude support yet.
 * Returns null to let the default fallback handle it.
 */
export async function handleSticker(_filePath: string): Promise<any[] | null> {
  return null;
}
