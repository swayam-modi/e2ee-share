/**
 * Safe conversion helper for Web Crypto API parameters.
 *
 * In TypeScript 5.7+, Uint8Array defaults to Uint8Array<ArrayBufferLike> (which includes SharedArrayBuffer),
 * whereas DOM Web Crypto API type definitions specify BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer.
 * This helper provides explicit typing without using `any` or `@ts-ignore`.
 */
export function toBufferSource(data: Uint8Array): BufferSource {
  return data as BufferSource;
}
