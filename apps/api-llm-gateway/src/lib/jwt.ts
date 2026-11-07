import jwt from 'jsonwebtoken'
import { JwtPayloadSchema, type JwtPayload } from '@platform/types'

export function verifyAndParseToken(token: string, secret: string): JwtPayload {
  const decoded = jwt.verify(token, secret)
  return JwtPayloadSchema.parse(decoded)
}
