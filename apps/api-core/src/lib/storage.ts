import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ApiCoreEnv } from '@platform/config'

type ServiceAccountKey = {
  client_email?: string
  private_key?: string
}

let cachedToken: { value: string; expiresAt: number } | null = null
let cachedKey: ServiceAccountKey | null = null

export class StorageNotConfiguredError extends Error {}

function base64url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function requireStorage(env: ApiCoreEnv) {
  if (!env.GCS_BUCKET_NAME || !env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new StorageNotConfiguredError('Google Cloud Storage is not configured')
  }
}

async function serviceAccountKey(env: ApiCoreEnv): Promise<ServiceAccountKey> {
  if (cachedKey) return cachedKey
  const key = JSON.parse(await readFile(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')) as ServiceAccountKey
  if (!key.client_email || !key.private_key) throw new StorageNotConfiguredError('Invalid service account key')
  cachedKey = key
  return key
}

async function accessToken(env: ApiCoreEnv): Promise<string> {
  requireStorage(env)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const key = await serviceAccountKey(env)
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key!, 'base64url')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })
  const body = await response.json() as { access_token?: string; expires_in?: number }
  if (!response.ok || !body.access_token) throw new Error('Google Cloud authentication failed')
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return body.access_token
}

export async function uploadEvidenceFile(
  env: ApiCoreEnv,
  name: string,
  mimeType: string,
  data: Buffer,
): Promise<string> {
  const token = await accessToken(env)
  const objectName = `evidence/${name}`
  const bytes = new Uint8Array(data.length)
  bytes.set(data)
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.GCS_BUCKET_NAME)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
      body: new Blob([bytes.buffer], { type: mimeType }),
    },
  )
  const body = await response.json() as { name?: string }
  if (!response.ok || !body.name) throw new Error('Google Cloud Storage upload failed')
  return body.name
}

export async function deleteEvidenceFile(env: ApiCoreEnv, objectName: string): Promise<void> {
  const token = await accessToken(env)
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.GCS_BUCKET_NAME)}/o/${encodeURIComponent(objectName)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok && response.status !== 404) throw new Error('Google Cloud Storage delete failed')
}

export async function downloadEvidenceFile(env: ApiCoreEnv, objectName: string): Promise<Buffer> {
  const token = await accessToken(env)
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.GCS_BUCKET_NAME)}/o/${encodeURIComponent(objectName)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) throw new Error(`Google Cloud Storage download failed (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}
