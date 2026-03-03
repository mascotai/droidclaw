import { object, string, pipe, minLength, picklist, optional } from 'valibot';

export const createKeySchema = object({
	name: pipe(string(), minLength(1, 'Please enter a name for the API key')),
	type: optional(picklist(['user', 'device'], 'Invalid key type'), 'user')
});

export const deleteKeySchema = object({
	keyId: pipe(string(), minLength(1, 'Key ID is required'))
});
