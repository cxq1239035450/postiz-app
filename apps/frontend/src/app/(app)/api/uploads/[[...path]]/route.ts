import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync } from 'fs';
import type { ReadStream } from 'fs';
import { resolve, sep } from 'path';
import mime from 'mime';
async function* nodeStreamToIterator(
  stream: ReadStream
): AsyncGenerator<Uint8Array, undefined, unknown> {
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('Expected a binary file stream');
    }
    yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return undefined;
}
function iteratorToStream(iterator: AsyncIterator<Uint8Array, undefined, unknown>) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
  });
}
export const GET = async (
  request: NextRequest,
  context: {
    params: Promise<{
      path?: string[];
    }>;
  }
) => {
  const { path } = await context.params;
  const uploadDirectory = process.env.UPLOAD_DIRECTORY;
  if (!uploadDirectory?.trim()) {
    console.error('Local uploads require UPLOAD_DIRECTORY to be configured.');
    return new NextResponse('Local upload storage is not configured', { status: 503 });
  }
  const base = resolve(uploadDirectory);
  const filePath = resolve(base, (path ?? []).join('/'));
  // Confine reads to UPLOAD_DIRECTORY. resolve() collapses any `..` segments
  // (including URL-decoded ones), so this blocks every path-traversal variant.
  if (filePath !== base && !filePath.startsWith(base + sep)) {
    return new NextResponse('Not found', { status: 404 });
  }
  let fileStats;
  try {
    fileStats = statSync(filePath);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) {
      return new NextResponse('Not found', { status: 404 });
    }
    throw error;
  }
  if (!fileStats.isFile()) {
    return new NextResponse('Not found', { status: 404 });
  }
  const response = createReadStream(filePath);
  const contentType = mime.getType(filePath) || 'application/octet-stream';
  const iterator = nodeStreamToIterator(response);
  const webStream = iteratorToStream(iterator);
  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      // Set the appropriate content-type header
      'Content-Length': fileStats.size.toString(),
      // Set the content-length header
      'Last-Modified': fileStats.mtime.toUTCString(),
      // Set the last-modified header
      'Cache-Control': 'public, max-age=31536000, immutable', // Example cache-control header
    },
  });
};
