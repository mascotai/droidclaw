import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import {
	Plus,
	Trash2,
	Play,
	GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { track } from '@/lib/analytics/track';
import { DEVICE_WORKFLOW_SUBMIT } from '@/lib/analytics/events';

interface RunTabProps {
	deviceId: string;
}

const stepSchema = z.object({
	goal: z.string().min(1, 'Goal is required'),
	app: z.string().optional(),
	maxSteps: z.number().min(1).max(50),
	retries: z.number().min(0).max(5),
	cache: z.boolean(),
});

const workflowSchema = z.object({
	name: z.string().min(1, 'Workflow name is required'),
	steps: z.array(stepSchema).min(1, 'At least one step is required'),
});

type WorkflowForm = z.infer<typeof workflowSchema>;

export function RunTab({ deviceId }: RunTabProps) {
	const queryClient = useQueryClient();

	const {
		register,
		control,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<WorkflowForm>({
		resolver: zodResolver(workflowSchema),
		defaultValues: {
			name: '',
			steps: [{ goal: '', app: '', maxSteps: 15, retries: 0, cache: false }],
		},
	});

	const { fields, append, remove } = useFieldArray({
		control,
		name: 'steps',
	});

	const submitWorkflow = useMutation({
		mutationFn: (data: WorkflowForm) =>
			api.submitWorkflow({
				deviceId,
				name: data.name,
				steps: data.steps.map((s) => ({
					goal: s.goal,
					...(s.app && { app: s.app }),
					maxSteps: s.maxSteps,
					retries: s.retries,
					cache: s.cache,
				})),
			}),
		onSuccess: (result) => {
			toast.success('Workflow submitted', {
				description: `Run ID: ${result.runId}`,
			});
			queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
			reset();
		},
		onError: (err) => {
			toast.error('Failed to submit workflow', {
				description: err.message,
			});
		},
	});

	return (
		<div className="space-y-6">
			<form
				onSubmit={handleSubmit((data) => {
					track(DEVICE_WORKFLOW_SUBMIT);
					submitWorkflow.mutate(data);
				})}
				className="space-y-6"
			>
				{/* Workflow name */}
				<div className="rounded-xl border border-stone-200 bg-white p-6">
					<label className="block text-sm font-semibold text-stone-900">
						Workflow name
					</label>
					<input
						{...register('name')}
						type="text"
						placeholder="e.g., Login and post"
						className="mt-2 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
					/>
					{errors.name && (
						<p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
					)}
				</div>

				{/* Steps */}
				<div className="space-y-3">
					{fields.map((field, index) => (
						<div
							key={field.id}
							className="rounded-xl border border-stone-200 bg-white p-5"
						>
							<div className="flex items-start justify-between">
								<div className="flex items-center gap-2">
									<GripVertical className="h-4 w-4 text-stone-300" />
									<span className="text-sm font-semibold text-stone-700">
										Step {index + 1}
									</span>
								</div>
								{fields.length > 1 && (
									<button
										type="button"
										onClick={() => remove(index)}
										className="rounded p-1 text-stone-400 hover:text-red-500"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								)}
							</div>

							<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="sm:col-span-2">
									<label className="block text-xs font-medium text-stone-600">
										Goal
									</label>
									<input
										{...register(`steps.${index}.goal`)}
										type="text"
										placeholder="e.g., Open Instagram and tap the search icon"
										className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
									/>
									{errors.steps?.[index]?.goal && (
										<p className="mt-1 text-xs text-red-500">
											{errors.steps[index].goal?.message}
										</p>
									)}
								</div>

								<div>
									<label className="block text-xs font-medium text-stone-600">
										App package (optional)
									</label>
									<input
										{...register(`steps.${index}.app`)}
										type="text"
										placeholder="com.instagram.android"
										className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
									/>
								</div>

								<div className="flex gap-3">
									<div className="flex-1">
										<label className="block text-xs font-medium text-stone-600">
											Max steps
										</label>
										<input
											{...register(`steps.${index}.maxSteps`, {
												valueAsNumber: true,
											})}
											type="number"
											min={1}
											max={50}
											className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
										/>
									</div>
									<div className="flex-1">
										<label className="block text-xs font-medium text-stone-600">
											Retries
										</label>
										<input
											{...register(`steps.${index}.retries`, {
												valueAsNumber: true,
											})}
											type="number"
											min={0}
											max={5}
											className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
										/>
									</div>
								</div>
							</div>
						</div>
					))}
				</div>

				{/* Add step + submit */}
				<div className="flex items-center justify-between">
					<button
						type="button"
						onClick={() =>
							append({ goal: '', app: '', maxSteps: 15, retries: 0, cache: false })
						}
						className="flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
					>
						<Plus className="h-4 w-4" />
						Add step
					</button>

					<button
						type="submit"
						disabled={submitWorkflow.isPending}
						className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
					>
						<Play className="h-4 w-4" />
						{submitWorkflow.isPending ? 'Running...' : 'Run workflow'}
					</button>
				</div>
			</form>
		</div>
	);
}
