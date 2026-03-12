import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { authClient } from '@/lib/auth-client';
import { useState } from 'react';
import { track } from '@/lib/analytics/track';
import { AUTH_SIGNUP_SUBMIT, AUTH_SIGNUP_SUCCESS } from '@/lib/analytics/events';

const signupSchema = z.object({
	name: z.string().min(4, 'Name must be at least 4 characters'),
	email: z.email('Please enter a valid email'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
});

type SignupForm = z.infer<typeof signupSchema>;

export const Route = createFileRoute('/signup')({
	component: SignupPage,
});

function SignupPage() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<SignupForm>({
		resolver: zodResolver(signupSchema),
	});

	async function onSubmit(data: SignupForm) {
		setError(null);
		setLoading(true);
		track(AUTH_SIGNUP_SUBMIT);

		try {
			const result = await authClient.signUp.email({
				name: data.name,
				email: data.email,
				password: data.password,
			});

			if (result.error) {
				setError(result.error.message || 'Signup failed');
				return;
			}

			track(AUTH_SIGNUP_SUCCESS);
			navigate({ to: '/verify-email' });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Signup failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-stone-100">
			<div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-sm">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-stone-900">Create your account</h1>
					<p className="mt-1 text-sm text-stone-500">
						Get started with DroidClaw
					</p>
				</div>

				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					{error && (
						<div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
							{error}
						</div>
					)}

					<div>
						<label htmlFor="name" className="block text-sm font-medium text-stone-700">
							Name
						</label>
						<input
							{...register('name')}
							type="text"
							id="name"
							autoComplete="name"
							className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500"
						/>
						{errors.name && (
							<p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
						)}
					</div>

					<div>
						<label htmlFor="email" className="block text-sm font-medium text-stone-700">
							Email
						</label>
						<input
							{...register('email')}
							type="email"
							id="email"
							autoComplete="email"
							className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500"
							placeholder="you@example.com"
						/>
						{errors.email && (
							<p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
						)}
					</div>

					<div>
						<label htmlFor="password" className="block text-sm font-medium text-stone-700">
							Password
						</label>
						<input
							{...register('password')}
							type="password"
							id="password"
							autoComplete="new-password"
							className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:ring-violet-500"
						/>
						{errors.password && (
							<p className="mt-1 text-xs text-red-500">{errors.password.message}</p>
						)}
					</div>

					<button
						type="submit"
						disabled={loading}
						className="flex w-full justify-center rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800 disabled:opacity-50"
					>
						{loading ? 'Creating account...' : 'Create account'}
					</button>
				</form>

				<p className="text-center text-sm text-stone-500">
					Already have an account?{' '}
					<a href="/login" className="font-medium text-violet-600 hover:text-violet-500">
						Sign in
					</a>
				</p>
			</div>
		</div>
	);
}
