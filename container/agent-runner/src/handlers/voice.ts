/**
 * Default voice handler — tries skill transcription, falls back to default.
 *
 * Skill implementations listed here:
 *   - voice-openai: transcription via OpenAI Whisper API
 */
import { transcribe } from './voice-openai.js';

export async function handleVoice(filePath: string): Promise<any[] | null> {
  return transcribe(filePath);
}
