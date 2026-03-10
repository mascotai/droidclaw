import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(307, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	return {
		user: locals.user,
		sessionToken: locals.session?.token ?? '',
		plan: 'pro',
		licenseKey: null
	};
};
