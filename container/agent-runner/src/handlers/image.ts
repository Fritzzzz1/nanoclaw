/**
 * Default image handler — base64 embed for Claude-native formats.
 */
import fs from 'fs';
import path from 'path';

const NATIVE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function handleImage(filePath: string): Promise<any[] | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (!NATIVE_EXTS.includes(ext)) return null;
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath).toString('base64');
  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: MIME[ext] || 'application/octet-stream',
        data,
      },
    },
  ];
}
