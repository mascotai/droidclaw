import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Goal } from '@/types/devices';
import { useState } from 'react';
import { Target, Plus, Pencil, Trash2, Package, RotateCcw, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/shared/empty-state';

export const Route = createFileRoute('/_auth/dashboard/goals/')({
	component: GoalsPage,
});

interface GoalFormData {
	name: string;
	app: string;
	maxSteps: number;
	retries: number;
	cache: boolean;
}

const defaultFormData: GoalFormData = {
	name: '',
	app: '',
	maxSteps: 15,
	retries: 0,
	cache: true,
};

function GoalsPage() {
	const queryClient = useQueryClient();
	const [formOpen, setFormOpen] = useState(false);
	const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
	const [formData, setFormData] = useState<GoalFormData>(defaultFormData);
	const [deleteGoalTarget, setDeleteGoalTarget] = useState<Goal | null>(null);

	const { data: goals, isLoading } = useQuery({
		queryKey: ['goals'],
		queryFn: () => api.listGoals(),
	});

	const createGoal = useMutation({
		mutationFn: (data: Partial<Goal>) => api.createGoal(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['goals'] });
			toast.success('Goal created');
			closeForm();
		},
		onError: (err) => {
			toast.error('Failed to create goal', { description: err.message });
		},
	});

	const updateGoal = useMutation({
		mutationFn: ({ id, data }: { id: string; data: Partial<Goal> }) =>
			api.updateGoal(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['goals'] });
			toast.success('Goal updated');
			closeForm();
		},
		onError: (err) => {
			toast.error('Failed to update goal', { description: err.message });
		},
	});

	const deleteGoal = useMutation({
		mutationFn: (id: string) => api.deleteGoal(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['goals'] });
			toast.success('Goal deleted');
		},
		onError: (err) => {
			toast.error('Failed to delete goal', { description: err.message });
		},
	});

	function openCreate() {
		setEditingGoal(null);
		setFormData(defaultFormData);
		setFormOpen(true);
	}

	function openEdit(goal: Goal) {
		setEditingGoal(goal);
		setFormData({
			name: goal.name,
			app: goal.app || '',
			maxSteps: goal.maxSteps ?? 15,
			retries: goal.retries ?? 0,
			cache: goal.cache ?? true,
		});
		setFormOpen(true);
	}

	function closeForm() {
		setFormOpen(false);
		setEditingGoal(null);
		setFormData(defaultFormData);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const payload: Partial<Goal> = {
			name: formData.name.trim(),
			maxSteps: formData.maxSteps,
			retries: formData.retries,
			cache: formData.cache,
		};
		if (formData.app.trim()) {
			payload.app = formData.app.trim();
		}

		if (editingGoal) {
			updateGoal.mutate({ id: editingGoal.id, data: payload });
		} else {
			createGoal.mutate(payload);
		}
	}

	const isPending = createGoal.isPending || updateGoal.isPending;

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-stone-900">Goals</h1>
					<p className="mt-1 text-sm text-stone-500">
						Saved goal templates you can reuse across workflows
					</p>
				</div>
				<Button onClick={openCreate}>
					<Plus className="h-4 w-4" data-icon="inline-start" />
					Create goal
				</Button>
			</div>

			{/* Goals list */}
			<div className="space-y-2">
				{isLoading ? (
					<div className="space-y-2">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-20 animate-pulse rounded-xl border border-stone-200 bg-stone-100"
							/>
						))}
					</div>
				) : goals && goals.length > 0 ? (
					goals.map((goal: Goal) => (
						<div
							key={goal.id}
							className="group rounded-xl border border-stone-200 bg-white p-4 transition-colors hover:border-stone-300"
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex items-start gap-3 min-w-0">
									<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100">
										<Target className="h-4 w-4 text-stone-500" />
									</div>
									<div className="min-w-0">
										<p className="text-sm font-semibold text-stone-900 truncate">
											{goal.name}
										</p>
										<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
											{goal.app && (
												<Badge variant="outline" className="gap-1">
													<Package className="h-3 w-3" />
													{goal.app}
												</Badge>
											)}
											<Badge variant="secondary" className="gap-1">
												<Zap className="h-3 w-3" />
												{goal.maxSteps ?? 15} steps
											</Badge>
											{(goal.retries ?? 0) > 0 && (
												<Badge variant="secondary" className="gap-1">
													<RotateCcw className="h-3 w-3" />
													{goal.retries} {goal.retries === 1 ? 'retry' : 'retries'}
												</Badge>
											)}
											{goal.cache === false && (
												<Badge variant="secondary">No cache</Badge>
											)}
											{goal.eval && Object.keys(goal.eval).length > 0 && (
												<Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
													Eval
												</Badge>
											)}
										</div>
										<p className="mt-1.5 text-xs text-stone-400">
											Created{' '}
											{formatDistanceToNow(new Date(goal.createdAt), {
												addSuffix: true,
											})}
										</p>
									</div>
								</div>

								<div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => openEdit(goal)}
										title="Edit goal"
									>
										<Pencil className="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => setDeleteGoalTarget(goal)}
										title="Delete goal"
										className="text-stone-500 hover:text-red-600"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
							</div>
						</div>
					))
				) : (
					<EmptyState
						icon={Target}
						title="No saved goals yet"
						description="Create your first goal to reuse it across workflows."
					/>
				)}
			</div>

			{/* Create / Edit dialog */}
			<Dialog open={formOpen} onOpenChange={setFormOpen}>
				<DialogContent className="sm:max-w-md">
					<form onSubmit={handleSubmit}>
						<DialogHeader>
							<DialogTitle>
								{editingGoal ? 'Edit goal' : 'Create goal'}
							</DialogTitle>
							<DialogDescription>
								{editingGoal
									? 'Update the goal template configuration.'
									: 'Define a reusable goal template for your workflows.'}
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="goal-name">Name</Label>
								<Input
									id="goal-name"
									placeholder="e.g., Open Instagram, Post a photo"
									value={formData.name}
									onChange={(e) =>
										setFormData({ ...formData, name: e.target.value })
									}
									autoFocus
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="goal-app">App package</Label>
								<Input
									id="goal-app"
									placeholder="e.g., com.instagram.android (optional)"
									value={formData.app}
									onChange={(e) =>
										setFormData({ ...formData, app: e.target.value })
									}
								/>
								<p className="text-xs text-stone-400">
									The Android package to target. Leave empty for any app.
								</p>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="goal-steps">Max steps</Label>
									<Input
										id="goal-steps"
										type="number"
										min={1}
										max={100}
										value={formData.maxSteps}
										onChange={(e) =>
											setFormData({
												...formData,
												maxSteps: parseInt(e.target.value) || 15,
											})
										}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="goal-retries">Retries</Label>
									<Input
										id="goal-retries"
										type="number"
										min={0}
										max={10}
										value={formData.retries}
										onChange={(e) =>
											setFormData({
												...formData,
												retries: parseInt(e.target.value) || 0,
											})
										}
									/>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2.5">
								<div>
									<Label htmlFor="goal-cache" className="text-sm">
										Cache
									</Label>
									<p className="text-xs text-stone-400">
										Cache deterministic flows for faster replay
									</p>
								</div>
								<Switch
									id="goal-cache"
									checked={formData.cache}
									onCheckedChange={(checked: boolean) =>
										setFormData({ ...formData, cache: checked })
									}
								/>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={closeForm}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={!formData.name.trim() || isPending}
							>
								{isPending
									? editingGoal
										? 'Saving...'
										: 'Creating...'
									: editingGoal
										? 'Save changes'
										: 'Create goal'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete confirmation dialog */}
			<ConfirmDialog
				open={!!deleteGoalTarget}
				onOpenChange={(open) => {
					if (!open) setDeleteGoalTarget(null);
				}}
				title="Delete goal"
				description={`Are you sure you want to delete "${deleteGoalTarget?.name}"? This action cannot be undone.`}
				confirmLabel="Delete"
				variant="destructive"
				onConfirm={() => {
					if (deleteGoalTarget) {
						deleteGoal.mutate(deleteGoalTarget.id);
						setDeleteGoalTarget(null);
					}
				}}
			/>
		</div>
	);
}
