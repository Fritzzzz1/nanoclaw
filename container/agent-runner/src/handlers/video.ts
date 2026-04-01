/**
 * Default video handler — no native Claude support yet.
 * Returns null to let the default fallback handle it.
 */
export async function handleVideo(_filePath: string): Promise<any[] | null> {
  return null;
}
