NanoClaw Media Message Handling Spec
Date: March 9, 2026

Problem
Today NanoClaw only handles plain text messages across all channels. All non-text messages (images, voice, video, files, stickers, contacts, locations) are silently skipped. Claude natively supports several file types (images, PDFs, etc.), and we need to bridge that gap.
Architecture Overview
The solution has three layers:

Channel adapters (live inside each channel fork, not separate skills) — Extract/unwrap platform-specific messages into RawContentPart[] (no file I/O)
Core — processContentParts() that resolves raw parts into final ContentPart[] (download/save/convert), database, agent runner, handler dispatch — everything channel-agnostic
Skills — Pluggable processors for specific media types (image, voice, etc.)

1. Message Format & Flow
   The content field on a message changes from string to string | ContentPart[].
   Plain text messages continue as a raw string (no breaking change). Anything more complex goes through a two-stage pipeline:
   Stage 1: Channel adapter → RawContentPart[]
   Each channel unwraps its platform-specific message and produces an array of raw content parts. These contain the type and whatever the platform gives us (URL, file ID, raw object):
   tstype RawContentPart =
   | { type: "text"; text: string }
   | { type: "image"; ref?: string; buffer?: Buffer; mimetype?: string } // platform URL, file ID, or pre-downloaded bytes
   | { type: "voice"; ref?: string; buffer?: Buffer; mimetype?: string }
   | { type: "video"; ref?: string; buffer?: Buffer; mimetype?: string }
   | { type: "audio"; ref?: string; buffer?: Buffer; mimetype?: string }
   | { type: "file"; ref?: string; buffer?: Buffer; filename: string; mimetype?: string }
   | { type: "sticker"; ref?: string; buffer?: Buffer; mimetype?: string }
   | { type: "contact"; data: object }
   | { type: "location"; lat: number; lng: number; name?: string }

   Note: The original spec used ref: string (required). The implementation widens media
   variants to accept either ref (URL/file ID — used by Telegram, Discord, etc.) or
   buffer (pre-downloaded bytes — used by WhatsApp/Baileys where E2E decryption happens
   client-side and produces bytes, not a URL). Approved by CEO.
   Stage 2: processContentParts() → ContentPart[]
   The channel adapter passes RawContentPart[] to processContentParts(), a channel-agnostic core function. Depending on the type, it either downloads and saves to a local path, or converts the raw data into a serializable representation (text, structured object, etc.):
   tstype ContentPart =
   | { type: "text"; text: string }
   | { type: "image"; path: string }
   | { type: "voice"; path: string }
   | { type: "video"; path: string }
   | { type: "audio"; path: string }
   | { type: "file"; path: string; filename: string }
   | { type: "sticker"; path: string }
   | { type: "contact"; text: string } // serialized to text
   | { type: "location"; text: string } // serialized to text
   Not every content type results in a file on disk. Some (like contact and location) are better represented as serialized text or structured data that can be passed directly to the agent without file I/O.
   ContentPart[] is what gets stored in the database and delivered to the agent.

2. Channel Adapter Responsibilities
   Channel adapters are part of the channel forks (not separate skills or core modules). Each channel fork (WhatsApp, Telegram, etc.) owns its adapter.
   A channel adapter has one job: extract the platform-specific message and produce a RawContentPart[]:

Unwraps the platform's native message structure
Produces a RawContentPart[] where media parts contain a ref (platform URL, file ID, or whatever the platform provides)
Calls processContentParts(rawParts) — from there, core takes over

3. processContentParts() (Core)
   Channel-agnostic function that sits between the channel adapter and the database/delivery pipeline. All channels call this with their RawContentPart[].
   Responsibilities:

Iterate over the RawContentPart[] from the channel adapter
For file-based types (image, voice, video, etc.): download media, save to the group-scoped media directory (<group_media_dir>/<generated_id_or_original_filename>), and set the local path
For non-file types (contact, location, etc.): convert the raw platform object into a serializable representation (text, structured data)
Return the finalized ContentPart[]

The channel adapter then passes the processed ContentPart[] to onMessage, which handles database storage and delivery to the agent. Since every ContentPart is a serializable object, storing it in the database is trivial.
This keeps all file I/O and storage logic in one place rather than duplicated across every channel fork.

4. Media Storage & Lifecycle
   All media files (regardless of type) are saved to the same group-scoped directory and follow the same cleanup rules. No special handling for Claude-native vs. non-native types.
   Cleanup: Delete all media files after 1 hour. If storage hits a size threshold before that, evict oldest files first (LRU). That's it — keep it simple.

5. Agent Runner: Handler Dispatch (Core)
   Inside the container, when the message queue delivers a message to the agent:

Parse content — if it's a string, proceed as today
If it's a ContentPart[], iterate over each part and call the registered handler for that type

Handler behavior by default
Content typeDefault handlerClaude-native (image, PDF, etc.)Read file, embed in Claude message as native contentNon-native (video, audio, sticker, etc.)Inject a text note: "User sent <type> file. Stored at <path>."
The agent (Claude) can then decide what to do with non-native files — use a CLI tool, invoke a skill, ask the user for clarification, etc.
Skill-based handler overrides
Each content type handler is a pluggable unit — import and call. A skill can register a replacement handler for any type. Examples:

A voice skill that transcribes audio locally before sending text to Claude
A video skill that extracts keyframes and sends them as images
A PDF skill that does custom extraction instead of relying on Claude's native PDF support

Skills bring channel-agnostic processors. The handler interface is simply: receives a file path, returns processed content to include in the Claude message.
Multiple handler options can exist per type (local processing, API-based, etc.). The user's installed skills determine which one is active.

6. Database Changes
   Add a new content_parts column rather than modifying the existing content column. This gives us a clean migration path:

New/migrated messages — content_parts is populated with the ContentPart[] JSON; content can be left as a plain-text fallback or summary
Legacy messages — content_parts is null; the system reads from the existing content string column as before

The agent runner and container-side message loader check content_parts first; if null, fall back to content. No changes to outer message metadata (timestamps, user info, group, etc.).

7. Implementation Plan
   Single PR, three sequential commits:
   CommitScopeWhat changes1CoreRawContentPart and ContentPart types, processContentParts() (download/save/convert), content_parts DB column + fallback logic, agent runner handler dispatch + handler registry, default handlers for Claude-native types (embed) and non-native types (file reference), skill override registration point2Two channel forks (WhatsApp + Telegram)Channel adapters that unwrap platform messages and produce RawContentPart[] — no file I/O in channel code. Two channels ensures the core abstraction isn't over-fitted to one platform and surfaces cross-channel edge cases early31–2 media skillsEnd-to-end skill implementations for specific media types (e.g., voice transcription, image processing). Proves the full pipeline works from channel → core → skill → Claude, and validates the handler override interface isn't just theoretical
   Remaining channel forks (Discord, Slack, Signal) follow in subsequent PRs using the same pattern established in commit 2.

8. Key Principles
   1. Keep it simple — happy path, 90% coverage, no edge cases
   2. Keep it small — ~500 lines core, thin adapters, minimal skills
   3. Keep it readable — NanoClaw's codebase is meant to be audited in 8 minutes
   4. No file I/O in channel adapters — all file operations happen in core
   5. Backward compatible — plain text messages must work exactly as before
   6. Credit community — if we close or supersede someone's PR, add them as contributors
   7. Consult on big decisions — if something architectural is unclear, ask Gavriel before building the wrong thing
   8. Multiple sessions — this doesn't need to be rushed. Sit with it. Think it through. Then build it clean.
