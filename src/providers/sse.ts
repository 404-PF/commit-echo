export type AnthropicSseState = {
  currentEvent: string;
};

export function parseOpenAiSseLine(line: string): {
  text?: string;
  done?: boolean;
  error?: string;
} {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) return {};

  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return { done: true };

  try {
    const parsed = JSON.parse(payload) as {
      error?: { message?: string };
      choices?: { delta?: { content?: string } }[];
    };

    if (parsed.error?.message) {
      return { error: parsed.error.message };
    }

    const content = parsed.choices?.[0]?.delta?.content;
    if (content) return { text: content };
  } catch {
    // Skip malformed JSON chunks
  }

  return {};
}

export function* parseAnthropicSseLines(
  lines: string[],
  state: AnthropicSseState,
): Generator<string, boolean> {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('event:')) {
      state.currentEvent = trimmed.slice(6).trim();
      continue;
    }

    if (!trimmed.startsWith('data:')) continue;

    const payload = trimmed.slice(5).trim();

    if (state.currentEvent === 'content_block_delta') {
      try {
        const parsed = JSON.parse(payload) as { delta?: { text?: string } };
        if (parsed.delta?.text) yield parsed.delta.text;
      } catch {
        // Skip malformed JSON
      }
      continue;
    }

    if (state.currentEvent === 'error') {
      let message = 'Anthropic streaming error';
      try {
        const parsed = JSON.parse(payload) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Use default message
      }
      throw new Error(message);
    }

    if (state.currentEvent === 'message_stop') {
      return true;
    }
  }

  return false;
}
