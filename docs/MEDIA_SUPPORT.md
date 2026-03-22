# Media Support

NanoClaw handles all message types across channels — images, voice, video, audio, files, stickers, contacts, and locations. Media files are saved to group-scoped directories, delivered to the agent with appropriate handling, and cleaned up automatically.

## How It Works

When a non-text message arrives from any channel, it flows through three stages:

**Stage 1 — Channel adapter** extracts the platform-specific message into a `RawContentPart[]`. Each media part contains either a URL/file ID (`ref`) or pre-downloaded bytes (`buffer`). The adapter then calls `processContentParts()`.

**Stage 2 — `processContentParts()`** (in `src/media.ts`) downloads and saves media to the group's `media/` directory, and converts contacts and locations to text. The result is a `ContentPart[]` that gets stored in the database.

**Stage 3 — Agent runner** (inside the container) picks up the message, parses `<media>` tags, and dispatches each content part through the handler chain:

- **Registered skill handlers** run first, in priority order (e.g., voice transcription via OpenAI Whisper API).
- **Claude-native types** (images, PDFs) are embedded directly in the Claude message as base64 content blocks.
- **Non-native types** (video, audio, sticker, etc.) produce a text note: `"User sent <Type> file. Stored at <path>."`.

## Supported Types

| Type     | Default Behavior                                                 |
| -------- | ---------------------------------------------------------------- |
| Image    | Saved to disk, embedded natively in Claude message               |
| File     | Saved to disk; PDFs embedded natively, others notified with path |
| Voice    | Saved to disk, agent notified with file path                     |
| Audio    | Saved to disk, agent notified with file path                     |
| Video    | Saved to disk, agent notified with file path                     |
| Sticker  | Saved to disk, agent notified with file path                     |
| Contact  | Serialized to text (name + vcard)                                |
| Location | Serialized to text (lat, lng, name)                              |

## Media Lifecycle

All media files are saved to `groups/<folder>/media/` and cleaned up automatically:

- Files older than **1 hour** are deleted.
- If total size exceeds **500 MB** per group, oldest files are evicted first (LRU).
- Cleanup runs every 10 minutes.

## Adding Media Skill Handlers

Skills can register handlers to process specific media types instead of the default behavior. When a handler succeeds, its result replaces what the agent would normally receive. Handlers run inside the agent container — they intercept `<media>` tags in the formatted message and return replacement content blocks for the Claude message.

### Handler File Convention

Create a `.js` file in `container/handlers/`. It will be auto-discovered by the agent runner at container startup.

Each file default-exports either a single registration or an array:

```javascript
// container/handlers/my-skill.js
import fs from 'fs';

async function handler(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const result = doSomething(filePath);
  return [{ type: 'text', text: result }];
}

export default [
  { type: 'voice', priority: 50, handler },
  { type: 'audio', priority: 50, handler },
];
```

**Fields:**

- `type` — the content type to handle (`voice`, `audio`, `video`, `image`, `file`, `sticker`)
- `priority` — lower number = higher priority (runs first). If it fails or returns empty/null, the next handler tries.
- `handler` — async function that receives the absolute file path and returns content blocks or null

### Example: Voice Transcription

The voice transcription skill (`/add-voice-transcription`) adds `container/handlers/voice-openai.js`. It intercepts voice and audio files, calls the OpenAI Whisper API, and delivers a text transcript to Claude instead of the raw audio file path:

```javascript
async function handler(filePath) {
  if (!process.env.OPENAI_API_KEY) return null;
  // ... call OpenAI Whisper API ...
  return [{ type: 'text', text: `[Voice transcript]: ${text}` }];
}

export default [
  { type: 'voice', priority: 50, handler },
  { type: 'audio', priority: 50, handler },
];
```

### Example: PDF Text Extraction

The PDF reader skill (`/add-pdf-reader`) adds `container/handlers/pdf-extract.js`. It overrides the default behavior for PDFs — instead of embedding the PDF as a native base64 document block, it extracts the text via `pdftotext` and delivers it as plain text to the agent, including context and actual file path for later usage of skill tools:

```javascript
async function handler(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') return null;
  // ... run pdftotext, get extracted text ...
  return [
    {
      type: 'text',
      text: `[PDF "${filename}" — ${pages} pages. Auto-extracted by pdf-reader skill. File available at ${filePath}]:\n\n${text}`,
    },
  ];
}

export default [{ type: 'file', priority: 50, handler }];
```

This handler registers for `type: 'file'` and checks for `.pdf` extension — non-PDF files fall through to the default behavior. If extraction fails (e.g., scanned/image-only PDF), it returns null and Claude receives the PDF as a native document embed instead.
