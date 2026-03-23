import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { ContentPart, RawContentPart } from './types.js';

const MEDIA_TTL_MS = 60 * 60 * 1000; // 1 hour
const MEDIA_MAX_BYTES = 500 * 1024 * 1024; // 500 MB per group before LRU eviction
const MEDIA_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // run cleanup every 10 minutes
const MEDIA_DIR = 'media';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/ogg; codecs=opus': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
  'application/ogg': '.ogg',
  'application/gzip': '.tgs',
};

function ext(mimetype?: string, fallback = '.bin'): string {
  if (!mimetype) return fallback;
  return MIME_EXT[mimetype] || fallback;
}

async function downloadRef(ref: string): Promise<Buffer | null> {
  try {
    const res = await fetch(ref);
    if (!res.ok) {
      logger.warn({ ref, status: res.status }, 'Failed to download media ref');
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn({ ref, err }, 'Failed to download media ref');
    return null;
  }
}

async function resolveBuffer(part: {
  ref?: string;
  buffer?: Buffer;
}): Promise<Buffer | null> {
  if (part.buffer) return part.buffer;
  if (part.ref) return downloadRef(part.ref);
  return null;
}

function saveFile(
  mediaDir: string,
  buffer: Buffer,
  extension: string,
  messageId: string,
): string {
  // Use messageId for idempotent saves — same message won't re-download
  const safeId =
    messageId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) ||
    crypto.randomUUID().slice(0, 12);
  const filename = `${safeId}${extension}`;
  const filepath = path.join(mediaDir, filename);
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, buffer);
  }
  return `${MEDIA_DIR}/${filename}`;
}

const MEDIA_TYPE_DEFAULTS: Record<string, string> = {
  image: '.jpg',
  voice: '.ogg',
  video: '.mp4',
  audio: '.mp3',
  sticker: '.webp',
};

/**
 * Process raw content parts from a channel adapter into finalized content parts.
 * Saves media buffers to the group's media directory.
 */
export async function processContentParts(
  parts: RawContentPart[],
  groupFolder: string,
  messageId: string,
): Promise<ContentPart[]> {
  const groupDir = resolveGroupFolderPath(groupFolder);
  const mediaDir = path.join(groupDir, MEDIA_DIR);
  fs.mkdirSync(mediaDir, { recursive: true });

  const result: ContentPart[] = [];

  for (const part of parts) {
    if (part.type in MEDIA_TYPE_DEFAULTS) {
      const buf = await resolveBuffer(
        part as { ref?: string; buffer?: Buffer },
      );
      if (!buf) {
        logger.warn({ messageId }, `Skipping ${part.type} — no data`);
        continue;
      }
      const p = saveFile(
        mediaDir,
        buf,
        ext(
          (part as { mimetype?: string }).mimetype,
          MEDIA_TYPE_DEFAULTS[part.type],
        ),
        messageId,
      );
      result.push({ type: part.type, path: p } as ContentPart);
      continue;
    }

    switch (part.type) {
      case 'text':
        result.push({ type: 'text', text: part.text });
        break;
      case 'file': {
        const buf = await resolveBuffer(part);
        if (!buf) {
          logger.warn({ messageId }, 'Skipping file — no data');
          break;
        }
        const e = path.extname(part.filename) || ext(part.mimetype);
        const p = saveFile(mediaDir, buf, e, messageId);
        result.push({ type: 'file', path: p, filename: part.filename });
        break;
      }
      case 'contact': {
        const name = (part.data.displayName as string) || 'Unknown';
        const vcard = (part.data.vcard as string) || '';
        const text = `[Contact: ${name}${vcard ? `\n${vcard}` : ''}]`;
        result.push({ type: 'contact', text });
        break;
      }
      case 'location': {
        const label = part.name ? ` (${part.name})` : '';
        const text = `[Location: ${part.lat}, ${part.lng}${label}]`;
        result.push({ type: 'location', text });
        break;
      }
    }
  }

  return result;
}

export function contentPartsToText(parts: ContentPart[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text;
        case 'image':
          return `[Image: ${part.path}]`;
        case 'voice':
          return `[Voice message: ${part.path}]`;
        case 'video':
          return `[Video: ${part.path}]`;
        case 'audio':
          return `[Audio: ${part.path}]`;
        case 'file':
          return `[File "${part.filename}": ${part.path}]`;
        case 'sticker':
          return `[Sticker: ${part.path}]`;
        case 'contact':
          return part.text;
        case 'location':
          return part.text;
      }
    })
    .join('\n');
}

export function cleanupMedia(groupFolder: string): void {
  const mediaDir = path.join(resolveGroupFolderPath(groupFolder), MEDIA_DIR);
  if (!fs.existsSync(mediaDir)) return;

  const now = Date.now();
  try {
    const files = fs.readdirSync(mediaDir).map((name) => {
      const filepath = path.join(mediaDir, name);
      const stat = fs.statSync(filepath);
      return { filepath, mtimeMs: stat.mtimeMs, size: stat.size };
    });

    // Phase 1: TTL — delete files older than 1 hour
    const remaining = files.filter((f) => {
      if (now - f.mtimeMs > MEDIA_TTL_MS) {
        fs.unlinkSync(f.filepath);
        return false;
      }
      return true;
    });

    // Phase 2: LRU — if total size exceeds threshold, evict oldest first
    let totalSize = remaining.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MEDIA_MAX_BYTES) {
      remaining.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
      for (const f of remaining) {
        if (totalSize <= MEDIA_MAX_BYTES) break;
        fs.unlinkSync(f.filepath);
        totalSize -= f.size;
      }
    }
  } catch (err) {
    logger.warn({ groupFolder, err }, 'Media cleanup error');
  }
}

/** Start periodic media cleanup for all registered groups. */
export function startMediaCleanup(
  getGroupFolders: () => string[],
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    for (const folder of getGroupFolders()) {
      cleanupMedia(folder);
    }
  }, MEDIA_CLEANUP_INTERVAL_MS);
}
