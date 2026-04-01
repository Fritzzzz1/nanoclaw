/**
 * Default sticker handler — embeds as image if Claude-native format.
 * Returns null for unsupported formats (e.g. animated .tgs).
 */
import { handleImage } from './image.js';

export async function handleSticker(
  filePath: string,
): Promise<any[] | null> {
  return handleImage(filePath);
}
