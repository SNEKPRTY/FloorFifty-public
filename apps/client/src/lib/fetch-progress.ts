/**
 * Reading a response while counting what arrives.
 *
 * `response.json()` and `response.blob()` say nothing until the last byte is
 * in, which on a slow phone link is a long silence for a loader to sit in and
 * for the stall rule to misread as a dead connection. These read the body
 * chunk by chunk and report each one, so a bar can move and the meter can
 * hear that the link is alive.
 */

/** Called after each chunk with the bytes so far and the size the server announced, if it did. */
export type OnReceived = (received: number, total: number | undefined) => void;

/** The announced size. Undefined for an encoded body, whose length is not the bytes we read. */
function announcedSize(response: Response): number | undefined {
  if (response.headers?.get("content-encoding")) return undefined;
  const length = Number(response.headers?.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

async function readChunks(response: Response, onReceived: OnReceived | undefined): Promise<Uint8Array[] | undefined> {
  // A stand-in response (a test's) has no stream; the caller reads it whole.
  const reader = response.body?.getReader?.();
  if (reader === undefined) return undefined;
  const total = announcedSize(response);
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
    received += value.byteLength;
    onReceived?.(received, total);
  }
}

/** The body as JSON, read as it arrives. */
export async function readJson<T>(response: Response, onReceived?: OnReceived): Promise<T> {
  const chunks = await readChunks(response, onReceived);
  if (chunks === undefined) {
    const whole = (await response.json()) as T;
    onReceived?.(0, undefined);
    return whole;
  }
  // One decoder over the whole stream, so a character cut by a chunk boundary is joined.
  const decoder = new TextDecoder();
  let text = "";
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return JSON.parse(text) as T;
}

/** The body as a blob of `type`, read as it arrives. */
export async function readBlob(response: Response, type: string, onReceived?: OnReceived): Promise<Blob> {
  const chunks = await readChunks(response, onReceived);
  if (chunks === undefined) {
    const whole = await response.blob();
    onReceived?.(whole.size, whole.size);
    return whole;
  }
  return new Blob(chunks as BlobPart[], { type });
}
