import nodemailer from 'nodemailer'
import type { ApiCoreEnv } from '@platform/config'

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export async function sendInviteEmail(
  env: ApiCoreEnv,
  invite: { candidateName: string; candidateEmail?: string; assessmentTitle: string; inviteUrl: string; expiresAt: Date; timeLimitMinutes: number },
): Promise<boolean> {
  if (!invite.candidateEmail || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return false
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  })
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: invite.candidateEmail,
    subject: `ApexCoder assessment: ${invite.assessmentTitle}`,
    text: [
      `Hello ${invite.candidateName},`,
      '',
      `You have been invited to complete the following ApexCoder assessment: ${invite.assessmentTitle}.`,
      '',
      `Assessment duration: ${invite.timeLimitMinutes} minutes`,
      `Invite expires: ${invite.expiresAt.toUTCString()}`,
      '',
      `Start assessment: ${invite.inviteUrl}`,
      '',
      'Please complete the assessment in a quiet environment with a stable internet connection. If proctoring is enabled, keep the required camera, microphone, and screen-sharing permissions available during the assessment.',
      '',
      'Regards,',
      'ApexCoder Assessments Team',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6">
        <p>Hello ${escapeHtml(invite.candidateName)},</p>
        <p>You have been invited to complete the following ApexCoder assessment:</p>
        <p><strong>${escapeHtml(invite.assessmentTitle)}</strong></p>
        <p><strong>Assessment duration:</strong> ${invite.timeLimitMinutes} minutes<br>
        <strong>Invite expires:</strong> ${invite.expiresAt.toUTCString()}</p>
        <p><a href="${escapeHtml(invite.inviteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">Start assessment</a></p>
        <p>Please complete the assessment in a quiet environment with a stable internet connection. If proctoring is enabled, keep the required camera, microphone, and screen-sharing permissions available during the assessment.</p>
        <p>Regards,<br>ApexCoder Assessments Team</p>
      </div>
    `,
  })
  return true
}

export async function sendAdminApprovedEmail(
  env: ApiCoreEnv,
  admin: { name?: string | null; email: string; loginUrl: string },
): Promise<boolean> {
  // Admin approvals authenticate as team@ with its own credentials (separate
  // mailbox from the assessments@ sender used for invites).
  if (!env.SMTP_HOST || !env.TEAM_SMTP_USER || !env.TEAM_SMTP_PASS) return false
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.TEAM_SMTP_USER, pass: env.TEAM_SMTP_PASS },
  })
  const greeting = admin.name?.trim() ? admin.name.trim() : 'there'
  await transport.sendMail({
    from: env.TEAM_EMAIL_FROM,
    to: admin.email,
    subject: 'Your ApexCoder admin account is approved',
    text: [
      `Hello ${greeting},`,
      '',
      'Good news — your ApexCoder admin account request has been approved.',
      '',
      'You can now sign in with the email and password you registered and start creating assessments, inviting candidates, and reviewing results.',
      '',
      `Sign in: ${admin.loginUrl}`,
      '',
      'Welcome aboard — we hope you enjoy the experience.',
      '',
      'Regards,',
      'The ApexCoder Team',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6">
        <p>Hello ${escapeHtml(greeting)},</p>
        <p>Good news — your <strong>ApexCoder</strong> admin account request has been approved.</p>
        <p>You can now sign in with the email and password you registered and start creating assessments, inviting candidates, and reviewing results.</p>
        <p><a href="${escapeHtml(admin.loginUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">Sign in to ApexCoder</a></p>
        <p>Welcome aboard — we hope you enjoy the experience.</p>
        <p>Regards,<br>The ApexCoder Team</p>
      </div>
    `,
  })
  return true
}
