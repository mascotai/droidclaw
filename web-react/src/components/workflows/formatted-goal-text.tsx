const VAR_PATTERN = /(\{\{[^}]+\}\})/g;

interface FormattedGoalTextProps {
	text: string;
	className?: string;
}

export function FormattedGoalText({ text, className }: FormattedGoalTextProps) {
	const parts = text.split(VAR_PATTERN);

	return (
		<span className={className} style={{ whiteSpace: 'pre-wrap' }}>
			{parts.map((part, i) =>
				VAR_PATTERN.test(part) ? (
					<code
						key={i}
						className="rounded bg-violet-100 px-1 py-0.5 text-[0.85em] font-mono text-violet-700"
					>
						{part}
					</code>
				) : (
					<span key={i}>{part}</span>
				),
			)}
		</span>
	);
}
