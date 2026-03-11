import { createFileRoute } from '@tanstack/react-router';
import { Mail } from 'lucide-react';

export const Route = createFileRoute('/verify-email')({
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-stone-100">
			<div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 text-center shadow-sm">
				<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-100">
					<Mail className="h-8 w-8 text-violet-600" />
				</div>
				<h1 className="text-2xl font-bold text-stone-900">Check your email</h1>
				<p className="text-stone-600">
					We&apos;ve sent you a verification link. Click the link in the email to verify
					your account and get started.
				</p>
				<p className="text-sm text-stone-400">
					The link expires in 1 hour. Didn&apos;t receive it? Check your spam folder.
				</p>
				<a
					href="/login"
					className="inline-block text-sm font-medium text-violet-600 hover:text-violet-500"
				>
					Back to login
				</a>
			</div>
		</div>
	);
}
