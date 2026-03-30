import { NextRequest } from 'next/server';

const ENGINE_SSE_URL = 'http://localhost:3001/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let upstream: Response | null = null;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      try {
        upstream = await fetch(ENGINE_SSE_URL, {
          headers: { Accept: 'text/event-stream' },
          // @ts-expect-error -- Node fetch supports signal but types may not match
          signal: AbortSignal.timeout(0), // no timeout
        });

        if (!upstream.ok || !upstream.body) {
          // Send an error event and close
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', data: { message: 'Engine unavailable' } })}\n\n`)
          );
          controller.close();
          return;
        }

        reader = upstream.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Forward raw SSE bytes from engine to client
          const text = decoder.decode(value, { stream: true });
          controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        // Send error event on connection failure
        const message = err instanceof Error ? err.message : 'Unknown error';
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', data: { message } })}\n\n`)
          );
        } catch {
          // Controller may already be closed
        }
      } finally {
        try { reader?.cancel(); } catch { /* ignore */ }
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
