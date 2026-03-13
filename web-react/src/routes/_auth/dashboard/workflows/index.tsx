import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Workflow, WorkflowStepConfig } from '@/types/devices';
import { useState } from 'react';
import {
	Workflow as WorkflowIcon,
	Plus,
	Pencil,
	Trash2,
	GripVertical,
	X,
	Variable,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from '@/components/ui/dialog';

export const Route = createFileRoute('/_auth/dashboard/workflows/')({
	component: WorkflowsPage,
});

// ── Types ──

interface StepDraft {
	goal: string;
	app: string;
	maxSteps: number;
	retries: number;
	cache: boolean;
}

interface VariableDraft {
	key: string;
	value: string;
}

const emptyStep: StepDraft = { goal: '', app: '', maxSteps: 15, retries: 0, cache: false };

// ── Page ──

function WorkflowsPage() {
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

	// Form state
	const [name, setName] = useState('');
	const [steps, setSteps] = useState<StepDraft[]>([{ ...emptyStep }]);
	const [variables, setVariables] = useState<VariableDraft[]>([]);

	const { data: workflows, isLoading } = useQuery({
		queryKey: ['workflowTemplates'],
		queryFn: () => api.listWorkflowTemplates(),
	});

	const createWorkflow = useMutation({
		mutationFn: (data: { name: string; steps: Record<string, unknown>[]; variables?: Record<string, string> }) =>
			api.createWorkflowTemplate(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
			toast.success('Workflow created');
			closeDialog();
		},
		onError: (err) => {
			toast.error('Failed to create workflow', { description: err.message });
		},
	});

	const updateWorkflow = useMutation({
		mutationFn: ({ id, data }: { id: string; data: Partial<Workflow> }) =>
			api.updateWorkflowTemplate(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
			toast.success('Workflow updated');
			closeDialog();
		},
		onError: (err) => {
			toast.error('Failed to update workflow', { description: err.message });
		},
	});

	const deleteWorkflow = useMutation({
		mutationFn: (id: string) => api.deleteWorkflowTemplate(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
			toast.success('Workflow deleted');
			setDeleteConfirm(null);
		},
		onError: (err) => {
			toast.error('Failed to delete workflow', { description: err.message });
		},
	});

	function closeDialog() {
		setDialogOpen(false);
		setEditingId(null);
		setName('');
		setSteps([{ ...emptyStep }]);
		setVariables([]);
	}

	function openCreate() {
		setEditingId(null);
		setName('');
		setSteps([{ ...emptyStep }]);
		setVariables([]);
		setDialogOpen(true);
	}

	function openEdit(workflow: Workflow) {
		setEditingId(workflow.id);
		setName(workflow.name);
		setSteps(
			workflow.steps.map((s: WorkflowStepConfig) => ({
				goal: s.goal ?? '',
				app: s.app ?? '',
				maxSteps: s.maxSteps ?? 15,
				retries: s.retries ?? 0,
				cache: s.cache ?? false,
			})),
		);
		setVariables(
			workflow.variables
				? Object.entries(workflow.variables).map(([key, value]) => ({ key, value }))
				: [],
		);
		setDialogOpen(true);
	}

	function handleSave() {
		if (!name.trim()) return;
		const validSteps = steps.filter((s) => s.goal.trim());
		if (validSteps.length === 0) return;

		const stepsPayload = validSteps.map((s) => {
			const step: Record<string, unknown> = { goal: s.goal };
			if (s.app.trim()) step.app = s.app;
			if (s.maxSteps !== 15) step.maxSteps = s.maxSteps;
			if (s.retries > 0) step.retries = s.retries;
			if (s.cache) step.cache = true;
			return step;
		});

		const varsPayload = variables.reduce(
			(acc, v) => {
				if (v.key.trim()) acc[v.key] = v.value;
				return acc;
			},
			{} as Record<string, string>,
		);

		const payload = {
			name: name.trim(),
			steps: stepsPayload,
			...(Object.keys(varsPayload).length > 0 ? { variables: varsPayload } : {}),
		};

		if (editingId) {
			updateWorkflow.mutate({ id: editingId, data: payload });
		} else {
			createWorkflow.mutate(payload);
		}
	}

	function updateStep(index: number, patch: Partial<StepDraft>) {
		setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
	}

	function removeStep(index: number) {
		setSteps((prev) => prev.filter((_, i) => i !== index));
	}

	function addStep() {
		setSteps((prev) => [...prev, { ...emptyStep }]);
	}

	function addVariable() {
		setVariables((prev) => [...prev, { key: '', value: '' }]);
	}

	function updateVariable(index: number, patch: Partial<VariableDraft>) {
		setVariables((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
	}

	function removeVariable(index: number) {
		setVariables((prev) => prev.filter((_, i) => i !== index));
	}

	const isSaving = createWorkflow.isPending || updateWorkflow.isPending;

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-stone-900">Workflows</h1>
					<p className="mt-1 text-sm text-stone-500">
						Build and manage reusable multi-step workflows
					</p>
				</div>
				<button
					onClick={openCreate}
					className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
				>
					<Plus className="h-4 w-4" />
					New workflow
				</button>
			</div>

			{/* Workflows list */}
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<h3 className="text-sm font-semibold text-stone-900">Saved workflows</h3>
				{isLoading ? (
					<div className="mt-4 space-y-3">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-16 animate-pulse rounded-lg bg-stone-100"
							/>
						))}
					</div>
				) : workflows && workflows.length > 0 ? (
					<div className="mt-4 space-y-2">
						{workflows.map((wf: Workflow) => (
							<div
								key={wf.id}
								className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3"
							>
								<div className="flex items-center gap-3 min-w-0">
									<WorkflowIcon className="h-4 w-4 shrink-0 text-stone-400" />
									<div className="min-w-0">
										<p className="text-sm font-medium text-stone-700 truncate">
											{wf.name}
										</p>
										<div className="flex items-center gap-2 text-xs text-stone-400">
											<span>
												{wf.steps.length} {wf.steps.length === 1 ? 'step' : 'steps'}
											</span>
											{wf.variables && Object.keys(wf.variables).length > 0 && (
												<span className="flex items-center gap-0.5">
													<Variable className="h-3 w-3" />
													{Object.keys(wf.variables).length}
												</span>
											)}
											<span>
												Updated{' '}
												{formatDistanceToNow(new Date(wf.updatedAt), {
													addSuffix: true,
												})}
											</span>
										</div>
									</div>
								</div>

								<div className="flex items-center gap-1 shrink-0">
									<button
										onClick={() => openEdit(wf)}
										className="rounded p-1.5 text-stone-400 hover:text-stone-600"
										title="Edit workflow"
									>
										<Pencil className="h-4 w-4" />
									</button>

									{deleteConfirm === wf.id ? (
										<div className="flex items-center gap-2">
											<button
												onClick={() => deleteWorkflow.mutate(wf.id)}
												className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
											>
												Confirm
											</button>
											<button
												onClick={() => setDeleteConfirm(null)}
												className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-50"
											>
												Cancel
											</button>
										</div>
									) : (
										<button
											onClick={() => setDeleteConfirm(wf.id)}
											className="rounded p-1.5 text-stone-400 hover:text-red-500"
											title="Delete workflow"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="mt-4 flex flex-col items-center py-8">
						<WorkflowIcon className="h-8 w-8 text-stone-300" />
						<p className="mt-2 text-sm text-stone-500">
							No saved workflows yet
						</p>
						<button
							onClick={openCreate}
							className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
						>
							Create your first workflow
						</button>
					</div>
				)}
			</div>

			{/* Create / Edit Dialog */}
			<Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
				<DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{editingId ? 'Edit workflow' : 'New workflow'}
						</DialogTitle>
						<DialogDescription>
							{editingId
								? 'Update workflow name, steps, and variables.'
								: 'Define a multi-step workflow with goals to execute in sequence.'}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-5">
						{/* Name */}
						<div>
							<label className="block text-xs font-medium text-stone-600">
								Workflow name
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g., Login and check feed"
								className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
							/>
						</div>

						{/* Steps */}
						<div>
							<div className="flex items-center justify-between">
								<label className="block text-xs font-medium text-stone-600">
									Steps
								</label>
								<button
									onClick={addStep}
									className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700"
								>
									<Plus className="h-3 w-3" />
									Add step
								</button>
							</div>
							<div className="mt-2 space-y-3">
								{steps.map((step, idx) => (
									<div
										key={idx}
										className="rounded-lg border border-stone-200 bg-stone-50 p-3"
									>
										<div className="flex items-start gap-2">
											<GripVertical className="mt-2 h-4 w-4 shrink-0 text-stone-300" />
											<div className="flex-1 space-y-2">
												<div className="flex items-center gap-2">
													<span className="shrink-0 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-600">
														{idx + 1}
													</span>
													<input
														type="text"
														value={step.goal}
														onChange={(e) =>
															updateStep(idx, { goal: e.target.value })
														}
														placeholder="Goal — e.g., Open the Settings app"
														className="flex-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-violet-500 focus:ring-violet-500"
													/>
												</div>
												<div className="flex flex-wrap gap-2">
													<input
														type="text"
														value={step.app}
														onChange={(e) =>
															updateStep(idx, { app: e.target.value })
														}
														placeholder="App package (optional)"
														className="min-w-[140px] flex-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500"
													/>
													<div className="flex items-center gap-1">
														<label className="text-[10px] text-stone-500">
															Max steps
														</label>
														<input
															type="number"
															value={step.maxSteps}
															onChange={(e) =>
																updateStep(idx, {
																	maxSteps: parseInt(e.target.value) || 15,
																})
															}
															min={1}
															max={50}
															className="w-14 rounded border border-stone-300 bg-white px-2 py-1.5 text-center text-xs focus:border-violet-500 focus:ring-violet-500"
														/>
													</div>
													<div className="flex items-center gap-1">
														<label className="text-[10px] text-stone-500">
															Retries
														</label>
														<input
															type="number"
															value={step.retries}
															onChange={(e) =>
																updateStep(idx, {
																	retries: parseInt(e.target.value) || 0,
																})
															}
															min={0}
															max={10}
															className="w-14 rounded border border-stone-300 bg-white px-2 py-1.5 text-center text-xs focus:border-violet-500 focus:ring-violet-500"
														/>
													</div>
												</div>
											</div>
											<button
												onClick={() => removeStep(idx)}
												disabled={steps.length === 1}
												className="mt-1 rounded p-1 text-stone-400 hover:text-red-500 disabled:opacity-30"
												title="Remove step"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
								))}
							</div>
						</div>

						{/* Variables */}
						<div>
							<div className="flex items-center justify-between">
								<label className="block text-xs font-medium text-stone-600">
									Variables
									<span className="ml-1 font-normal text-stone-400">
										(optional)
									</span>
								</label>
								<button
									onClick={addVariable}
									className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700"
								>
									<Plus className="h-3 w-3" />
									Add variable
								</button>
							</div>
							{variables.length > 0 ? (
								<div className="mt-2 space-y-2">
									{variables.map((v, idx) => (
										<div key={idx} className="flex items-center gap-2">
											<input
												type="text"
												value={v.key}
												onChange={(e) =>
													updateVariable(idx, { key: e.target.value })
												}
												placeholder="Key"
												className="w-1/3 rounded border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-mono focus:border-violet-500 focus:ring-violet-500"
											/>
											<input
												type="text"
												value={v.value}
												onChange={(e) =>
													updateVariable(idx, { value: e.target.value })
												}
												placeholder="Default value"
												className="flex-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500"
											/>
											<button
												onClick={() => removeVariable(idx)}
												className="rounded p-1 text-stone-400 hover:text-red-500"
												title="Remove variable"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									))}
								</div>
							) : (
								<p className="mt-2 text-xs text-stone-400">
									Use {'{{variable_name}}'} in goal text to reference variables at runtime.
								</p>
							)}
						</div>
					</div>

					<DialogFooter>
						<button
							onClick={closeDialog}
							className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
						>
							Cancel
						</button>
						<button
							onClick={handleSave}
							disabled={!name.trim() || !steps.some((s) => s.goal.trim()) || isSaving}
							className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
						>
							{isSaving
								? 'Saving...'
								: editingId
									? 'Update workflow'
									: 'Create workflow'}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
