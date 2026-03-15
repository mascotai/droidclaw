import type { WorkflowStepConfig } from '@/types/devices';
import { type ReactNode } from 'react';

interface WorkflowGraphProps {
	steps: WorkflowStepConfig[];
	/** Status per step index — used for live run view */
	stepStatuses?: Array<'pending' | 'running' | 'success' | 'failed'>;
}

const NODE_WIDTH = 280;
const NODE_MIN_HEIGHT = 56;
const NODE_GAP = 40;
const ARROW_SIZE = 6;
const RETRY_ARC_OFFSET = 32;

const STATUS_COLORS = {
	pending: {
		bg: '#f5f5f4', // stone-100
		border: '#d6d3d1', // stone-300
		text: '#57534e', // stone-600
	},
	running: {
		bg: '#ede9fe', // violet-100
		border: '#8b5cf6', // violet-500
		text: '#6d28d9', // violet-700
	},
	success: {
		bg: '#dcfce7', // green-100
		border: '#22c55e', // green-500
		text: '#15803d', // green-700
	},
	failed: {
		bg: '#fee2e2', // red-100
		border: '#ef4444', // red-500
		text: '#b91c1c', // red-700
	},
};

function truncateText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1) + '\u2026';
}

export function WorkflowGraph({ steps, stepStatuses }: WorkflowGraphProps) {
	if (steps.length === 0) return null;

	// Calculate node heights based on content
	const nodeHeights = steps.map((step) => {
		const goalLines = Math.ceil(step.goal.length / 35);
		const hasBadges = !!(step.app || (step.retries ?? 0) > 0 || step.forceStop);
		const baseHeight = NODE_MIN_HEIGHT + (goalLines > 1 ? (goalLines - 1) * 16 : 0);
		return hasBadges ? baseHeight + 20 : baseHeight;
	});

	const totalHeight = nodeHeights.reduce((sum, h) => sum + h, 0) + (steps.length - 1) * NODE_GAP + 16;
	const hasRetries = steps.some((s) => (s.retries ?? 0) > 0);
	const svgWidth = NODE_WIDTH + (hasRetries ? RETRY_ARC_OFFSET * 2 + 20 : 40);
	const offsetX = hasRetries ? RETRY_ARC_OFFSET + 10 : 20;

	// Calculate Y positions
	const nodeYPositions: number[] = [];
	let currentY = 8;
	for (let i = 0; i < steps.length; i++) {
		nodeYPositions.push(currentY);
		currentY += nodeHeights[i] + NODE_GAP;
	}

	return (
		<div className="overflow-x-auto">
			<svg
				width={svgWidth}
				height={totalHeight}
				viewBox={`0 0 ${svgWidth} ${totalHeight}`}
				className="mx-auto"
			>
				<defs>
					{/* Arrow marker */}
					<marker
						id="wf-arrow"
						markerWidth={ARROW_SIZE}
						markerHeight={ARROW_SIZE}
						refX={ARROW_SIZE}
						refY={ARROW_SIZE / 2}
						orient="auto"
					>
						<path
							d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`}
							fill="#a8a29e"
						/>
					</marker>
					{/* Retry arrow marker */}
					<marker
						id="wf-retry-arrow"
						markerWidth={ARROW_SIZE}
						markerHeight={ARROW_SIZE}
						refX={ARROW_SIZE}
						refY={ARROW_SIZE / 2}
						orient="auto"
					>
						<path
							d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`}
							fill="#f59e0b"
						/>
					</marker>
				</defs>

				{steps.map((step, idx) => {
					const status = stepStatuses?.[idx] ?? 'pending';
					const colors = STATUS_COLORS[status];
					const y = nodeYPositions[idx];
					const h = nodeHeights[idx];
					const centerX = offsetX + NODE_WIDTH / 2;

					return (
						<g key={idx}>
							{/* Connection arrow to next node */}
							{idx < steps.length - 1 && (
								<line
									x1={centerX}
									y1={y + h}
									x2={centerX}
									y2={nodeYPositions[idx + 1]}
									stroke="#a8a29e"
									strokeWidth={1.5}
									markerEnd="url(#wf-arrow)"
								/>
							)}

							{/* Retry loop arc */}
							{(step.retries ?? 0) > 0 && (
								<>
									<path
										d={`M ${offsetX + NODE_WIDTH + 4} ${y + h / 2 - 10}
											Q ${offsetX + NODE_WIDTH + RETRY_ARC_OFFSET} ${y + h / 2}
											  ${offsetX + NODE_WIDTH + 4} ${y + h / 2 + 10}`}
										fill="none"
										stroke="#f59e0b"
										strokeWidth={1.5}
										strokeDasharray="4 2"
										markerEnd="url(#wf-retry-arrow)"
									/>
									<text
										x={offsetX + NODE_WIDTH + RETRY_ARC_OFFSET + 2}
										y={y + h / 2 + 4}
										fontSize={9}
										fill="#d97706"
										fontWeight={500}
									>
										{step.retries}x
									</text>
								</>
							)}

							{/* Node rectangle */}
							<rect
								x={offsetX}
								y={y}
								width={NODE_WIDTH}
								height={h}
								rx={10}
								ry={10}
								fill={colors.bg}
								stroke={colors.border}
								strokeWidth={1.5}
							/>

							{/* Step number circle */}
							<circle
								cx={offsetX + 20}
								cy={y + 20}
								r={10}
								fill={colors.border}
							/>
							<text
								x={offsetX + 20}
								y={y + 24}
								textAnchor="middle"
								fontSize={11}
								fontWeight={700}
								fill="white"
							>
								{idx + 1}
							</text>

							{/* Goal text */}
							<text
								x={offsetX + 38}
								y={y + 24}
								fontSize={12}
								fill={colors.text}
								fontWeight={500}
							>
								{truncateText(step.goal, 30)}
							</text>

							{/* Badges row */}
							{(() => {
								let badgeX = offsetX + 38;
								const badgeY = y + 42;
								const badges: ReactNode[] = [];

								if (step.app) {
									const appLabel = truncateText(step.app.split('.').pop() ?? step.app, 12);
									badges.push(
										<g key="app">
											<rect x={badgeX} y={badgeY - 10} width={appLabel.length * 6.5 + 16} height={16} rx={4} fill="white" stroke="#d6d3d1" strokeWidth={0.75} />
											<text x={badgeX + 8} y={badgeY + 2} fontSize={9} fill="#78716c">{appLabel}</text>
										</g>,
									);
									badgeX += appLabel.length * 6.5 + 22;
								}

								if ((step.retries ?? 0) > 0) {
									badges.push(
										<g key="retries">
											<rect x={badgeX} y={badgeY - 10} width={40} height={16} rx={4} fill="#fef3c7" stroke="#fbbf24" strokeWidth={0.75} />
											<text x={badgeX + 6} y={badgeY + 2} fontSize={9} fill="#92400e">{step.retries}x retry</text>
										</g>,
									);
									badgeX += 46;
								}

								if (step.forceStop) {
									badges.push(
										<g key="force-stop">
											<rect x={badgeX} y={badgeY - 10} width={52} height={16} rx={4} fill="#fee2e2" stroke="#fca5a5" strokeWidth={0.75} />
											<text x={badgeX + 6} y={badgeY + 2} fontSize={9} fill="#b91c1c">force stop</text>
										</g>,
									);
								}

								return badges.length > 0 ? <>{badges}</> : null;
							})()}
						</g>
					);
				})}
			</svg>
		</div>
	);
}
