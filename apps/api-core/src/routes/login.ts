import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { Prisma, prisma } from '@platform/db'
import { z } from 'zod'
import { CreateAdminAccountRequestSchema, CreateAdminSignupRequestSchema, LoginRequestSchema } from '@platform/types'
import { sendError } from '../lib/errors'
import { sendAdminApprovedEmail } from '../lib/email'
import { signAdminToken } from '../lib/jwt'
import type { RouteOptions } from '../types'

export async function loginRoutes(fastify: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { requireMaster } = opts.authHooks
  const idParam = z.object({ id: z.string().uuid() })

  /**
   * POST /api/v1/auth/login
   * Public - no authentication required.
   * Admin-only: students have no password and will always fail the hash check.
   */
  fastify.post('/api/v1/auth/login', async (request, reply) => {
    const result = LoginRequestSchema.safeParse(request.body)
    if (!result.success) {
      const msg = result.error.errors[0]?.message ?? 'Invalid request body'
      return sendError(reply, 'VALIDATION_ERROR', msg)
    }

    const { email, password } = result.data

    const user = await prisma.user.findUnique({ where: { email } })

    // Return the same error for "user not found", "no password" (candidate),
    // and "wrong password" - never reveal which case matched.
    if (!user || !user.passwordHash || (user.role !== 'ADMIN' && user.role !== 'MASTER')) {
      const pendingRequest = await prisma.adminSignupRequest.findFirst({
        where: { email, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      })
      if (pendingRequest && await bcrypt.compare(password, pendingRequest.passwordHash)) {
        return sendError(reply, 'UNDER_REVIEW', 'Under Review')
      }
      return sendError(reply, 'UNAUTHORIZED', 'Invalid email or password')
    }

    const match = await bcrypt.compare(password, user.passwordHash)
    if (!match) {
      return sendError(reply, 'UNAUTHORIZED', 'Invalid email or password')
    }

    const accessToken = signAdminToken(user.id, opts.env.JWT_SECRET, user.role)

    return reply.status(200).send({
      data: { access_token: accessToken },
    })
  })

  fastify.post(
    '/api/v1/auth/admins',
    { preHandler: [requireMaster] },
    async (request, reply) => {
      const result = CreateAdminAccountRequestSchema.safeParse(request.body)
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? 'Invalid request body'
        return sendError(reply, 'VALIDATION_ERROR', msg)
      }

      try {
        const admin = await prisma.user.create({
          data: {
            email: result.data.email,
            passwordHash: await bcrypt.hash(result.data.password, 10),
            role: 'ADMIN',
          },
          select: { id: true, email: true, role: true, createdAt: true },
        })

        return reply.status(201).send({
          data: {
            id: admin.id,
            email: admin.email,
            role: admin.role,
            created_at: admin.createdAt.toISOString(),
          },
        })
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return sendError(reply, 'CONFLICT', 'An account with this email already exists')
        }
        throw err
      }
    },
  )

  fastify.get('/api/v1/auth/admins', { preHandler: [requireMaster] }, async (_request, reply) => {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        assessments: {
          select: {
            status: true,
            _count: { select: { sessions: true } },
          },
        },
      },
    })

    const data = await Promise.all(admins.map(async (admin) => ({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      created_at: admin.createdAt.toISOString(),
      total_assignments: admin.assessments.length,
      live_assignments: admin.assessments.filter((assessment) => assessment.status === 'ACTIVE').length,
      total_sessions: admin.assessments.reduce((sum, assessment) => sum + assessment._count.sessions, 0),
      active_sessions: await prisma.session.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() }, assessment: { createdBy: admin.id } } }),
      submitted_sessions: await prisma.session.count({ where: { status: 'SUBMITTED', assessment: { createdBy: admin.id } } }),
    })))

    return reply.status(200).send({ data })
  })

  fastify.delete('/api/v1/auth/admins/:id', { preHandler: [requireMaster] }, async (request, reply) => {
    const params = idParam.safeParse(request.params)
    if (!params.success) return sendError(reply, 'VALIDATION_ERROR', 'id must be a valid UUID')

    const admin = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, role: true } })
    if (!admin || admin.role !== 'ADMIN') return sendError(reply, 'NOT_FOUND', 'Admin account not found')

    await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'STUDENT', passwordHash: null },
    })
    return reply.status(200).send({ data: { id: admin.id } })
  })

  fastify.post('/api/v1/auth/admin-requests', async (request, reply) => {
    const result = CreateAdminSignupRequestSchema.safeParse(request.body)
    if (!result.success) {
      const msg = result.error.errors[0]?.message ?? 'Invalid request body'
      return sendError(reply, 'VALIDATION_ERROR', msg)
    }

    const email = result.data.email.toLowerCase()
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) return sendError(reply, 'CONFLICT', 'An account with this email already exists')

    const existingPending = await prisma.adminSignupRequest.findFirst({ where: { email, status: 'PENDING' } })
    if (existingPending) return sendError(reply, 'CONFLICT', 'This account request is already under review')

    const adminRequest = await prisma.adminSignupRequest.create({
      data: {
        email,
        fullName: result.data.fullName,
        companyName: result.data.companyName,
        passwordHash: await bcrypt.hash(result.data.password, 10),
      },
      select: { id: true, email: true, fullName: true, companyName: true, status: true, createdAt: true },
    })

    return reply.status(201).send({
      data: {
        id: adminRequest.id,
        email: adminRequest.email,
        full_name: adminRequest.fullName,
        company_name: adminRequest.companyName,
        status: adminRequest.status,
        created_at: adminRequest.createdAt.toISOString(),
      },
    })
  })

  fastify.get('/api/v1/auth/admin-requests', { preHandler: [requireMaster] }, async (_request, reply) => {
    const requests = await prisma.adminSignupRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, fullName: true, companyName: true, status: true, createdAt: true },
    })

    return reply.status(200).send({
      data: requests.map((adminRequest) => ({
        id: adminRequest.id,
        email: adminRequest.email,
        full_name: adminRequest.fullName,
        company_name: adminRequest.companyName,
        status: adminRequest.status,
        created_at: adminRequest.createdAt.toISOString(),
      })),
    })
  })

  fastify.post('/api/v1/auth/admin-requests/:id/approve', { preHandler: [requireMaster] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminRequest = await prisma.adminSignupRequest.findUnique({ where: { id } })
    if (!adminRequest || adminRequest.status !== 'PENDING') return sendError(reply, 'NOT_FOUND', 'Pending request not found')

    const existingUser = await prisma.user.findUnique({ where: { email: adminRequest.email } })
    // Email already belongs to an admin/master. Don't touch that account — approving
    // would silently reset its password to the request's. Resolve the request so it
    // leaves the pending list, and tell the master it already exists.
    if (existingUser && existingUser.role !== 'STUDENT') {
      await prisma.adminSignupRequest.update({
        where: { id },
        data: { status: 'REJECTED', reviewedAt: new Date() },
      })
      return sendError(reply, 'CONFLICT', 'An account with this email already exists')
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (existingUser) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: { passwordHash: adminRequest.passwordHash, role: 'ADMIN' },
          })
        } else {
          await tx.user.create({
            data: { email: adminRequest.email, passwordHash: adminRequest.passwordHash, role: 'ADMIN' },
          })
        }
        await tx.adminSignupRequest.update({
          where: { id },
          data: { status: 'APPROVED', reviewedAt: new Date() },
        })
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return sendError(reply, 'CONFLICT', 'An account with this email already exists')
      }
      throw err
    }

    const loginUrl = new URL('/login', opts.env.ADMIN_BASE_URL).toString()
    try {
      await sendAdminApprovedEmail(opts.env, { name: adminRequest.fullName, email: adminRequest.email, loginUrl })
    } catch (emailError) {
      request.log.error({ err: emailError }, 'Admin approval email failed')
    }

    return reply.status(200).send({ data: { id } })
  })

  fastify.post('/api/v1/auth/admin-requests/:id/reject', { preHandler: [requireMaster] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminRequest = await prisma.adminSignupRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: new Date() },
    })
    if (adminRequest.count === 0) return sendError(reply, 'NOT_FOUND', 'Pending request not found')

    return reply.status(200).send({ data: { id } })
  })
}
