import nodemailer from 'nodemailer';

const EMAIL_FROM = process.env.SMTP_FROM || 'DroidClaw <noreply@example.com>';

function getTransporter() {
	return nodemailer.createTransport({
		host: process.env.SMTP_HOST || 'smtp.gmail.com',
		port: parseInt(process.env.SMTP_PORT || '587'),
		secure: false,
		auth: {
			user: process.env.SMTP_USER,
			pass: process.env.SMTP_PASS,
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
