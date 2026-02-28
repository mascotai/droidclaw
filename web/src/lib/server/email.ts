import { env } from '$env/dynamic/private';
import nodemailer from 'nodemailer';

const EMAIL_FROM = env.SMTP_FROM || 'DroidClaw <noreply@example.com>';

function getTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

export async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  console.log('[Email] Sending to:', to, 'subject:', subject);
  const result = await getTransporter().sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text,
  });
  console.log('[Email] Sent:', result.messageId);
  return result;
}
