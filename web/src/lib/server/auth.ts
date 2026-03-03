import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { apiKey } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db';
import { getRequestEvent } from '$app/server';
import * as schema from './db/schema';
import { sendEmail } from './email';

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema
	}),
	plugins: [sveltekitCookies(getRequestEvent), apiKey()],
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			console.log('[Email] sendVerificationEmail called for:', user.email, 'url:', url);
			try {
				const result = await sendEmail({
					to: user.email,
					subject: 'Verify your DroidClaw email',
					text: `Hi ${user.name || 'there'},\n\nClick the link below to verify your email:\n\n${url}\n\nThis link expires in 1 hour.\n\n-- DroidClaw`
				});
			console.log('[Email] sendEmail result:', JSON.stringify(result));
			} catch (err) {
				console.error('[Email] Failed to send verification email:', err);
			}
		},
		sendOnSignUp: true,
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
		expiresIn: 3600
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true
	}
});
