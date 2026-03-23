---
name: add-pdf-reader
description: Add PDF reading to NanoClaw agents. Extracts text from PDFs via pdftotext CLI. Handles attachments from any channel, URLs, and local files.
---

# Add PDF Reader

> **Credits:** Based on the upstream `skill-add-pdf-reader` branch by the NanoClaw community. PDF extraction approach informed by contributions from [@vsabavat](https://github.com/vsabavat) (#917, #1055) and [@JasonOA888](https://github.com/JasonOA888) (#902).

Adds PDF reading to container agents via poppler-utils (`pdftotext`/`pdfinfo`). Two capabilities:

- **Auto-extraction handler** (`container/handlers/pdf-extract.js`) — intercepts incoming PDF attachments via the media handler system. When a PDF is sent in any channel, the handler runs `pdftotext` and delivers extracted text to Claude instead of the raw file. Falls through to Claude's native PDF embedding if extraction fails.

- **CLI tool** (`container/skills/pdf-reader/pdf-reader`) — on-demand PDF operations the agent can call via Bash: `extract`, `fetch` (download from URL), `info` (metadata), `list` (find all PDFs). Available regardless of whether auto-extraction is enabled.

## Phase 1: Pre-flight

Check if already applied:

```bash
test -f container/handlers/pdf-extract.js && echo "Already applied" || echo "Not applied"
```

If already applied, skip to Phase 3 (Verify).

## Phase 2: Apply

### Merge the skill branch

```bash
git fetch upstream skill/pdf-reader
git merge upstream/skill/pdf-reader || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue
}
```

This merges in:
- `container/handlers/pdf-extract.js` (media handler for auto-extraction)
- `container/skills/pdf-reader/pdf-reader` (CLI script)
- `container/skills/pdf-reader/SKILL.md` (agent-facing documentation)
- `poppler-utils` + CLI install in `container/Dockerfile`

No channel adapter changes — PDF download is handled by the core media pipeline (`src/media.ts`), which already saves `application/pdf` files for any channel.

### Ask the user

Use `AskUserQuestion` to ask:

> The PDF reader is installed. By default, PDFs sent in chat are **auto-extracted to text** before reaching the agent.
>
> Would you like to keep auto-extraction enabled? (yes/no)
>
> - **Yes (default):** Agent receives extracted text from PDFs automatically.
> - **No:** Agent receives the raw PDF via Claude's native document embedding. The `pdf-reader` CLI is still available for on-demand extraction.

If the user chooses **No**, remove or rename the handler file:

```bash
mv container/handlers/pdf-extract.js container/handlers/pdf-extract.js.disabled
```

The agent can re-enable it later by renaming it back.

### Build and restart

```bash
npm run build
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 3: Verify

Tell the user:

> Send a PDF in any registered chat. The agent should respond with understanding of the PDF content.

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i pdf
```

With auto-extraction enabled, look for:
- `[pdf-extract] pdftotext result: N chars` — extraction succeeded
- `[pdf-extract] Returning text result` — handler delivered text to agent

With auto-extraction disabled, look for:
- `Embedded document:` — Claude received the PDF natively

### Test CLI tool

Ask the agent to read a PDF from a URL:

> Use pdf-reader to fetch and read this PDF: [URL]

The agent should use `pdf-reader fetch <url>`.
