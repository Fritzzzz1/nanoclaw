import { Channel, ContentPart, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatContentParts(parts: ContentPart[]): string {
  return parts
    .map((part) => {
      const p = (v: string) => `/workspace/group/${escapeXml(v)}`;
      switch (part.type) {
        case 'text':
          return escapeXml(part.text);
        case 'image':
          return `<media type="image" path="${p(part.path)}" />`;
        case 'voice':
          return `<media type="voice" path="${p(part.path)}" />`;
        case 'video':
          return `<media type="video" path="${p(part.path)}" />`;
        case 'audio':
          return `<media type="audio" path="${p(part.path)}" />`;
        case 'file':
          return `<media type="file" path="${p(part.path)}" filename="${escapeXml(part.filename)}" />`;
        case 'sticker':
          return `<media type="sticker" path="${p(part.path)}" />`;
        case 'contact':
          return escapeXml(part.text);
        case 'location':
          return escapeXml(part.text);
      }
    })
    .join('\n');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    const body = m.content_parts
      ? formatContentParts(m.content_parts)
      : escapeXml(m.content);
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${body}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
