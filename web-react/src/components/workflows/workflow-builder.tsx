import { useState, useCallback, useMemo } from 'react';
import { Play, Square, Plus, Trash2, Settings2, X, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorkflowStepConfig } from '@/types/devices';

interface WorkflowBuilderProps {
	disabled?: boolean;
	onSubmit: (steps: WorkflowStepConfig[], variables: Record<string, string>) => void;
	onStop: () => void;
	isRunning?: boolean;
}

interface BuilderStep extends WorkflowStepConfig {
	_id: string;
}

function makeStep(): BuilderStep {
	return {
		_id: crypto.randomUUID(),
		goal: '',
		app: '',
		maxSteps: 15,
		retries: 0,
		cache: true,
		forceStop: false,
	};
}

const exampleGoals = [
	'Open YouTube and search for lofi beats',
	'Open Settings and enable Wi-Fi',
	'Open Google Maps and search for nearby coffee shops',
	'Take a screenshot and save it',
];

export function WorkflowBuilder({
	disabled = false,
	onSubmit,
	onStop,
	isRunning = false,
}: WorkflowBuilderProps) {
	const [steps, setSteps] = useState<BuilderStep[]>([makeStep()]);
	const [variables, setVariables] = useState<Array<{ key: string; value: string }>>([]);
	const [expandedAdvanced, setExpandedAdvanced] = useState<Set<string>>(new Set());

	const canSubmit = useMemo(
		() => steps.some((s) => s.goal.trim()) && !disabled && !isRunning,
		[steps, disabled, isRunning],
	);

	const addStep = useCallback(() => setSteps((s) => [...s, makeStep()]), []);

	const removeStep = useCallback(
		(id: string) => setSteps((s) => (s.length <= 1 ? s : s.filter((st) => st._id !== id))),
		[],
	);

	const updateStep = useCallback((id: string, field: keyof BuilderStep, value: unknown) => {
		setSteps((s) => s.map((st) => (st._id === id ? { ...st, [field]: value } : st)));
	}, []);

	const addVariable = useCallback(() => setVariables((v) => [...v, { key: '', value: '' }]), []);
	const removeVariable = useCallback((idx: number) => setVariables((v) => v.filter((_, i) => i !== idx)), []);
	const updateVariable = useCallback((idx: number, field: 'key' | 'value', val: string) => {
		setVariables((v) => v.map((item, i) => (i === idx ? { ...item, [field]: val } : item)));
	}, []);

	const toggleAdvanced = useCallback((id: string) => {
		setExpandedAdvanced((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	function handleSubmit() {
		const validSteps = steps
			.filter((s) => s.goal.trim())
			.map(({ _id, ...rest }) => {
				const step: WorkflowStepConfig = { goal: rest.goal.trim() };
				if (rest.app?.trim()) step.app = rest.app.trim();
				if (rest.maxSteps !== undefined && rest.maxSteps !== 15) step.maxSteps = rest.maxSteps;
				if (rest.retries !== undefined && rest.retries > 0) step.retries = rest.retries;
				if (rest.cache === false) step.cache = false;
				if (rest.forceStop) step.forceStop = true;
				return step;
			});
		if (validSteps.length === 0) return;

		const vars: Record<string, string> = {};
		for (const v of variables) {
			if (v.key.trim() && v.value.trim()) vars[v.key.trim()] = v.value.trim();
		}
		onSubmit(validSteps, vars);
	}

	function handleKeydown(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && steps.length === 1) {
			e.preventDefault();
			handleSubmit();
		}
	}

	return (
		<div className="rounded-xl bg-white p-5">
			<div className="mb-3 flex items-center justify-between">
				<p className="text-sm font-medium text-stone-700">
					{steps.length === 1 ? 'Run a task' : `Workflow \u00b7 ${steps.length} steps`}
				</p>
				{steps.length > 1 ? (
					<span className="text-xs text-stone-400">Steps run sequentially</span>
				) : null}
			</div>

			{/* Step cards */}
			<div className="space-y-3">
				{steps.map((step, idx) => (
					<div
						key={step._id}
						className="rounded-xl border border-stone-200 bg-stone-50 p-3 transition-colors hover:border-stone-300"
					>
						<div className="flex gap-2">
							{steps.length > 1 ? (
								<span className="mt-2 shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-xs text-stone-500">
									{idx + 1}
								</span>
							) : null}
							<div className="min-w-0 flex-1 space-y-2">
								<Textarea
									value={step.goal}
									onChange={(e) => updateStep(step._id, 'goal', e.target.value)}
									placeholder={
										idx === 0
											? 'e.g., Open YouTube and search for lofi beats'
											: 'Goal for this step'
									}
									disabled={isRunning}
									onKeyDown={handleKeydown}
									rows={3}
									className="resize-y text-sm"
								/>
								<Input
									type="text"
									value={step.app ?? ''}
									onChange={(e) => updateStep(step._id, 'app', e.target.value)}
									placeholder="App package (optional)"
									disabled={isRunning}
									className="text-xs"
								/>

								{/* Advanced toggle */}
								<button
									type="button"
									onClick={() => toggleAdvanced(step._id)}
									className="flex items-center gap-1 py-1 text-xs text-stone-400 hover:text-stone-600"
								>
									<Settings2 className="h-3 w-3" />
									Advanced
								</button>

								{expandedAdvanced.has(step._id) ? (
									<div className="flex flex-wrap items-center gap-4 rounded-lg bg-stone-100 px-3 py-2.5">
										<div className="flex items-center gap-1.5">
											<Label className="text-xs text-stone-500">Max steps</Label>
											<Input
												type="number"
												value={step.maxSteps ?? 15}
												onChange={(e) =>
													updateStep(step._id, 'maxSteps', parseInt(e.target.value) || 15)
												}
												min={1}
												max={50}
												disabled={isRunning}
												className="h-6 w-14 text-center text-xs"
											/>
										</div>
										<div className="flex items-center gap-1.5">
											<Label className="text-xs text-stone-500">Retries</Label>
											<Input
												type="number"
												value={step.retries ?? 0}
												onChange={(e) =>
													updateStep(step._id, 'retries', parseInt(e.target.value) || 0)
												}
												min={0}
												max={5}
												disabled={isRunning}
												className="h-6 w-12 text-center text-xs"
											/>
										</div>
										<div className="flex items-center gap-1.5">
											<Switch
												checked={step.cache !== false}
												onCheckedChange={(v) => updateStep(step._id, 'cache', v)}
												disabled={isRunning}
												className="scale-75"
											/>
											<Label className="text-xs text-stone-500">Cache</Label>
										</div>
										<div className="flex items-center gap-1.5">
											<Switch
												checked={step.forceStop === true}
												onCheckedChange={(v) => updateStep(step._id, 'forceStop', v)}
												disabled={isRunning}
												className="scale-75"
											/>
											<Label className="text-xs text-stone-500">Force stop</Label>
										</div>
									</div>
								) : null}
							</div>

							{steps.length > 1 ? (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => removeStep(step._id)}
									disabled={isRunning}
									className="mt-1.5 h-7 w-7 text-stone-300 hover:text-red-500"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							) : null}
						</div>
					</div>
				))}
			</div>

			{/* Add step */}
			<Button
				variant="outline"
				onClick={addStep}
				disabled={isRunning}
				className="mt-3 w-full gap-1.5 border-dashed text-stone-400 hover:text-stone-600"
			>
				<Plus className="h-4 w-4" />
				Add step
			</Button>

			{/* Variables */}
			{variables.length > 0 ? (
				<div className="mt-4 border-t border-stone-100 pt-3">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
						Variables
					</p>
					<div className="space-y-1.5">
						{variables.map((v, i) => (
							<div key={i} className="flex gap-2">
								<Input
									type="text"
									value={v.key}
									onChange={(e) => updateVariable(i, 'key', e.target.value)}
									placeholder="key"
									disabled={isRunning}
									className="w-28 font-mono text-xs"
								/>
								<Input
									type="text"
									value={v.value}
									onChange={(e) => updateVariable(i, 'value', e.target.value)}
									placeholder="value"
									disabled={isRunning}
									className="flex-1 text-xs"
								/>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => removeVariable(i)}
									disabled={isRunning}
									className="h-8 w-8 text-stone-300 hover:text-red-500"
								>
									<X className="h-3.5 w-3.5" />
								</Button>
							</div>
						))}
					</div>
				</div>
			) : null}

			{/* Bottom actions */}
			<div className="mt-4 flex items-center gap-2">
				{isRunning ? (
					<Button variant="destructive" onClick={onStop} className="flex-1 gap-2">
						<Square className="h-4 w-4" />
						Stop
					</Button>
				) : (
					<Button onClick={handleSubmit} disabled={!canSubmit} className="flex-1 gap-2">
						<Play className="h-4 w-4" />
						Run{steps.length > 1 ? ` ${steps.length} steps` : ''}
					</Button>
				)}
				<Button
					variant="outline"
					size="icon"
					onClick={addVariable}
					disabled={isRunning}
					title="Add variable"
				>
					<Code2 className="h-4 w-4" />
				</Button>
			</div>

			{/* Example goals */}
			{steps.length === 1 && !steps[0].goal.trim() && !isRunning ? (
				<div className="mt-4 border-t border-stone-100 pt-3">
					<p className="mb-2 text-xs font-medium text-stone-400">Try an example</p>
					<div className="flex flex-wrap gap-1.5">
						{exampleGoals.map((example) => (
							<button
								key={example}
								type="button"
								onClick={() => updateStep(steps[0]._id, 'goal', example)}
								className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-white"
							>
								{example}
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
