export type LocalReferenceFile = { id: string; path: string; contentBase64: string; size: number }

// Reads a browser File into base64 (chunked so large files don't blow the stack).
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// base64 length -> decoded byte size, same formula the server uses for display.
export function base64Size(contentBase64: string): number {
  return Math.floor((contentBase64.length * 3) / 4)
}

export const MAX_REFERENCE_FILE_BYTES = 6 * 1024 * 1024
export const MAX_REFERENCE_TOTAL_BYTES = 20 * 1024 * 1024
