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
const COND_ARC_OFFSET = 50;

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

// ── Graph Model ──

interface GraphNode {
	id: string;
	index: number;
	step: WorkflowStepConfig;
	hasEval: boolean;
	hasWhen: boolean;
	whenConditions: Array<{ sourceId: string; key: string; value: string }>;
}

interface GraphEdge {
	type: 'sequential' | 'conditional' | 'skip' | 'retry';
	fromIndex: number;
	toIndex: number;
	label?: string;
}

function buildGraphModel(steps: WorkflowStepConfig[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const nodes: GraphNode[] = steps.map((step, idx) => {
		const id = step.id ?? `step-${idx}`;
		const hasEval = !!step.eval;
		const hasWhen = !!step.when && Object.keys(step.when).length > 0;

		const whenConditions: Array<{ sourceId: string; key: string; value: string }> = [];
		if (step.when) {
			for (const [key, value] of Object.entries(step.when)) {
				// key format: "stepId.stateKey" or just "stateKey"
				const dotIdx = key.indexOf('.');
				if (dotIdx > -1) {
					whenConditions.push({
						sourceId: key.slice(0, dotIdx),
						key: key.slice(dotIdx + 1),
						value: String(value),
					});
				} else {
					whenConditions.push({ sourceId: '', key, value: String(value) });
				}
			}
		}

		return { id, index: idx, step, hasEval, hasWhen, whenConditions };
	});

	const edges: GraphEdge[] = [];
	const nodeIdToIndex = new Map<string, number>();
	nodes.forEach((n) => nodeIdToIndex.set(n.id, n.index));

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];

		// Retry edges
		if ((node.step.retries ?? 0) > 0) {
			edges.push({ type: 'retry', fromIndex: i, toIndex: i, label: `${node.step.retries}x` });
		}

		// Sequential or conditional edges
		if (i < nodes.length - 1) {
			const nextNode = nodes[i + 1];

			if (nextNode.hasWhen) {
				// Conditional edge: from the eval source step to this conditional step
				for (const cond of nextNode.whenConditions) {
					const sourceIdx = nodeIdToIndex.get(cond.sourceId);
					if (sourceIdx !== undefined) {
						edges.push({
							type: 'conditional',
							fromIndex: sourceIdx,
							toIndex: i + 1,
							label: `${cond.key}=${cond.value}`,
						});
					} else {
						// Fallback: previous step to next
						edges.push({
							type: 'conditional',
							fromIndex: i,
							toIndex: i + 1,
							label: `${cond.key}=${cond.value}`,
						});
					}
				}

				// Skip edge: from previous step, bypassing this conditional step to the one after it
				if (i + 2 < nodes.length) {
					edges.push({ type: 'skip', fromIndex: i, toIndex: i + 2 });
				}
			} else {
				// Normal sequential edge
				edges.push({ type: 'sequential', fromIndex: i, toIndex: i + 1 });
			}
		}
	}

	return { nodes, edges };
}

export function WorkflowGraph({ steps, stepStatuses }: WorkflowGraphProps) {
	if (steps.length === 0) return null;

	const { nodes, edges } = buildGraphModel(steps);

	// Calculate node heights based on content
	const nodeHeights = steps.map((step) => {
		const goalLines = Math.ceil(step.goal.length / 35);
		const hasBadges = !!(step.app || (step.retries ?? 0) > 0 || step.forceStop || step.eval);
		const baseHeight = NODE_MIN_HEIGHT + (goalLines > 1 ? (goalLines - 1) * 16 : 0);
		return hasBadges ? baseHeight + 20 : baseHeight;
	});

	const totalHeight = nodeHeights.reduce((sum, h) => sum + h, 0) + (steps.length - 1) * NODE_GAP + 16;
	const hasRetries = steps.some((s) => (s.retries ?? 0) > 0);
	const hasConditional = nodes.some((n) => n.hasWhen);
	const rightPad = hasRetries ? RETRY_ARC_OFFSET * 2 + 20 : 40;
	const leftPad = hasConditional ? COND_ARC_OFFSET + 10 : 20;
	const svgWidth = NODE_WIDTH + rightPad + leftPad;
	const offsetX = leftPad;

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
					{/* Arrow marker - sequential */}
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
					{/* Arrow marker - retry */}
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
					{/* Arrow marker - conditional */}
					<marker
						id="wf-cond-arrow"
						markerWidth={ARROW_SIZE}
						markerHeight={ARROW_SIZE}
						refX={ARROW_SIZE}
						refY={ARROW_SIZE / 2}
						orient="auto"
					>
						<path
							d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`}
							fill="#8b5cf6"
						/>
					</marker>
					{/* Arrow marker - skip */}
					<marker
						id="wf-skip-arrow"
						markerWidth={ARROW_SIZE}
						markerHeight={ARROW_SIZE}
						refX={ARROW_SIZE}
						refY={ARROW_SIZE / 2}
						orient="auto"
					>
						<path
							d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`}
							fill="#94a3b8"
						/>
					</marker>
				</defs>

				{/* Render edges */}
				{edges.map((edge, edgeIdx) => {
					const centerX = offsetX + NODE_WIDTH / 2;

					if (edge.type === 'sequential') {
						const fromY = nodeYPositions[edge.fromIndex] + nodeHeights[edge.fromIndex];
						const toY = nodeYPositions[edge.toIndex];
						return (
							<line
								key={`edge-${edgeIdx}`}
								x1={centerX}
								y1={fromY}
								x2={centerX}
								y2={toY}
								stroke="#a8a29e"
								strokeWidth={1.5}
								markerEnd="url(#wf-arrow)"
							/>
						);
					}

					if (edge.type === 'retry') {
						const y = nodeYPositions[edge.fromIndex];
						const h = nodeHeights[edge.fromIndex];
						return (
							<g key={`edge-${edgeIdx}`}>
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
									{edge.label}
								</text>
							</g>
						);
					}

					if (edge.type === 'conditional') {
						// Arc from right side of source node to right side of target node
						const fromY = nodeYPositions[edge.fromIndex] + nodeHeights[edge.fromIndex] / 2;
						const toY = nodeYPositions[edge.toIndex] + nodeHeights[edge.toIndex] / 2;
						const arcRight = offsetX + NODE_WIDTH + COND_ARC_OFFSET;
						return (
							<g key={`edge-${edgeIdx}`}>
								<path
									d={`M ${offsetX + NODE_WIDTH} ${fromY}
										Q ${arcRight} ${(fromY + toY) / 2}
										  ${offsetX + NODE_WIDTH} ${toY}`}
									fill="none"
									stroke="#8b5cf6"
									strokeWidth={1.5}
									strokeDasharray="6 3"
									markerEnd="url(#wf-cond-arrow)"
								/>
								{edge.label && (
									<text
										x={arcRight - 4}
										y={(fromY + toY) / 2 + 4}
										fontSize={8}
										fill="#7c3aed"
										fontWeight={500}
										textAnchor="end"
									>
										{edge.label}
									</text>
								)}
							</g>
						);
					}

					if (edge.type === 'skip') {
						// Arc from left side of source to left side of target
						const fromY = nodeYPositions[edge.fromIndex] + nodeHeights[edge.fromIndex] / 2;
						const toY = nodeYPositions[edge.toIndex] + nodeHeights[edge.toIndex] / 2;
						const arcLeft = offsetX - COND_ARC_OFFSET + 10;
						return (
							<g key={`edge-${edgeIdx}`}>
								<path
									d={`M ${offsetX} ${fromY}
										Q ${arcLeft} ${(fromY + toY) / 2}
										  ${offsetX} ${toY}`}
									fill="none"
									stroke="#94a3b8"
									strokeWidth={1}
									strokeDasharray="4 3"
									markerEnd="url(#wf-skip-arrow)"
								/>
								<text
									x={arcLeft + 4}
									y={(fromY + toY) / 2 + 4}
									fontSize={8}
									fill="#94a3b8"
									fontWeight={500}
								>
									skip
								</text>
							</g>
						);
					}

					return null;
				})}

				{/* Render nodes */}
				{nodes.map((node) => {
					const { index: idx, step, hasEval, hasWhen } = node;
					const status = stepStatuses?.[idx] ?? 'pending';
					const colors = STATUS_COLORS[status];
					const y = nodeYPositions[idx];
					const h = nodeHeights[idx];

					return (
						<g key={`node-${idx}`}>
							{/* Node rectangle */}
							<rect
								x={offsetX}
								y={y}
								width={NODE_WIDTH}
								height={h}
								rx={10}
								ry={10}
								fill={colors.bg}
								stroke={hasWhen ? '#3b82f6' : colors.border}
								strokeWidth={hasWhen ? 2 : 1.5}
								strokeDasharray={hasWhen ? '6 3' : undefined}
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

							{/* Eval badge */}
							{hasEval && (
								<g>
									<rect
										x={offsetX + NODE_WIDTH - 42}
										y={y + 6}
										width={34}
										height={16}
										rx={4}
										fill="#dcfce7"
										stroke="#86efac"
										strokeWidth={0.75}
									/>
									<text
										x={offsetX + NODE_WIDTH - 25}
										y={y + 18}
										fontSize={8}
										fill="#15803d"
										fontWeight={600}
										textAnchor="middle"
									>
										EVAL
									</text>
								</g>
							)}

							{/* When indicator */}
							{hasWhen && (
								<g>
									<rect
										x={offsetX + NODE_WIDTH - (hasEval ? 80 : 42)}
										y={y + 6}
										width={34}
										height={16}
										rx={4}
										fill="#dbeafe"
										stroke="#93c5fd"
										strokeWidth={0.75}
									/>
									<text
										x={offsetX + NODE_WIDTH - (hasEval ? 63 : 25)}
										y={y + 18}
										fontSize={8}
										fill="#1d4ed8"
										fontWeight={600}
										textAnchor="middle"
									>
										WHEN
									</text>
								</g>
							)}

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
