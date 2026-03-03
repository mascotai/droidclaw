import { createAuthClient } from 'better-auth/svelte';
import { apiKeyClient } from '@better-auth/api-key/client';

export const authClient = createAuthClient({
	baseURL: 'http://localhost:5173',
	plugins: [apiKeyClient()]
});
