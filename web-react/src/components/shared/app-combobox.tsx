import { useState } from 'react';
import {
	ChevronsUpDown,
	Check,
	Package,
	Plus,
	X,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
} from '@/components/ui/command';

export const COMMON_APPS = [
	{ value: 'com.instagram.android', label: 'Instagram' },
	{ value: 'com.twitter.android', label: 'Twitter / X' },
	{ value: 'com.facebook.katana', label: 'Facebook' },
	{ value: 'com.whatsapp', label: 'WhatsApp' },
	{ value: 'com.google.android.youtube', label: 'YouTube' },
	{ value: 'com.google.android.gm', label: 'Gmail' },
	{ value: 'com.google.android.apps.maps', label: 'Google Maps' },
	{ value: 'com.google.android.apps.photos', label: 'Google Photos' },
	{ value: 'com.android.chrome', label: 'Chrome' },
	{ value: 'com.android.settings', label: 'Settings' },
	{ value: 'com.android.vending', label: 'Play Store' },
	{ value: 'com.zhiliaoapp.musically', label: 'TikTok' },
	{ value: 'com.snapchat.android', label: 'Snapchat' },
	{ value: 'com.spotify.music', label: 'Spotify' },
	{ value: 'com.linkedin.android', label: 'LinkedIn' },
	{ value: 'org.telegram.messenger', label: 'Telegram' },
	{ value: 'com.reddit.frontpage', label: 'Reddit' },
	{ value: 'com.discord', label: 'Discord' },
];

interface AppComboboxProps {
	value: string;
	onChange: (value: string) => void;
	className?: string;
}

export function AppCombobox({ value, onChange, className }: AppComboboxProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');

	const matchedApp = COMMON_APPS.find((a) => a.value === value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={`flex items-center justify-between gap-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-left hover:bg-stone-50 focus:border-violet-500 focus:ring-violet-500 focus:outline-none ${className ?? ''}`}
				>
					<span className={value ? 'text-stone-700' : 'text-stone-400'}>
						{matchedApp
							? `${matchedApp.label} (${matchedApp.value})`
							: value || 'App package (optional)'}
					</span>
					<ChevronsUpDown className="h-3 w-3 shrink-0 text-stone-400" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-[320px] p-0" align="start">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search or type package name..."
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						<CommandEmpty>
							{search.trim() ? (
								<button
									type="button"
									onClick={() => {
										onChange(search.trim());
										setOpen(false);
										setSearch('');
									}}
									className="w-full px-3 py-2 text-left text-sm text-violet-600 hover:bg-violet-50"
								>
									Use "{search.trim()}"
								</button>
							) : (
								<span className="text-stone-400">Type a package name</span>
							)}
						</CommandEmpty>
						{value && (
							<CommandGroup heading="Current">
								<CommandItem
									value=""
									onSelect={() => {
										onChange('');
										setOpen(false);
										setSearch('');
									}}
								>
									<X className="h-3 w-3 text-stone-400" />
									<span className="text-stone-400">Clear selection</span>
								</CommandItem>
							</CommandGroup>
						)}
						<CommandGroup heading="Common apps">
							{COMMON_APPS.filter(
								(a) =>
									!search.trim() ||
									a.label.toLowerCase().includes(search.toLowerCase()) ||
									a.value.toLowerCase().includes(search.toLowerCase()),
							).map((app) => (
								<CommandItem
									key={app.value}
									value={app.value}
									onSelect={() => {
										onChange(app.value);
										setOpen(false);
										setSearch('');
									}}
								>
									<Package className="h-3 w-3 text-stone-400" />
									<span>{app.label}</span>
									<span className="ml-auto text-[10px] text-stone-400 font-mono">
										{app.value}
									</span>
									{value === app.value && (
										<Check className="h-3 w-3 text-violet-600" />
									)}
								</CommandItem>
							))}
						</CommandGroup>
						{search.trim() &&
							!COMMON_APPS.some(
								(a) => a.value.toLowerCase() === search.trim().toLowerCase(),
							) && (
								<CommandGroup heading="Custom">
									<CommandItem
										value={search.trim()}
										onSelect={() => {
											onChange(search.trim());
											setOpen(false);
											setSearch('');
										}}
									>
										<Plus className="h-3 w-3 text-violet-500" />
										<span>Use "{search.trim()}"</span>
									</CommandItem>
								</CommandGroup>
							)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
