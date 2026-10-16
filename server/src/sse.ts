export interface SseMessage {
  event?: string;
  data: string;
}

/** 增量解析 text/event-stream：喂入文本块，吐出完整的消息 */
export class SseParser {
  private buf = '';

  push(chunk: string): SseMessage[] {
    this.buf += chunk.replace(/\r\n/g, '\n');
    const out: SseMessage[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const msg = parseBlock(block);
      if (msg) out.push(msg);
    }
    return out;
  }

  flush(): SseMessage[] {
    const msg = this.buf.trim() ? parseBlock(this.buf) : null;
    this.buf = '';
    return msg ? [msg] : [];
  }
}

function parseBlock(block: string): SseMessage | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const c = line.indexOf(':');
    const field = c < 0 ? line : line.slice(0, c);
    const value = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length || event ? { event, data: data.join('\n') } : null;
}
