<script lang="ts">
	interface Props {
		ms: number;
		class?: string;
	}

	let { ms, class: cls = '' }: Props = $props();

	const display = $derived.by(() => {
		if (ms < 0) return '—';
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		if (mins < 60) return `${mins}m${remSecs > 0 ? `${remSecs}s` : ''}`;
		const hrs = Math.floor(mins / 60);
		const remMins = mins % 60;
		return `${hrs}h${remMins > 0 ? `${remMins}m` : ''}`;
	});
</script>

<span class={cls}>{display}</span>
