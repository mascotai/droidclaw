/**
 * DroidClaw E2E Test Client
 *
 * Wraps the DroidClaw API for test usage:
 * - Queue workflows from JSON files with variable substitution
 * - Poll for completion with configurable timeout
 * - Extract structured results for assertions
 */

import { readFileSync } from "fs";
import { resolve } from "path";

export interface WorkflowRunResult {
	runId: string;
	status: string;
	name: string;
	totalSteps: number;
	currentStep: number | null;
	goals: GoalResult[];
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
}

export interface GoalResult {
	goalId: string;
	goal: string;
	status: string;
	success: boolean;
	stepsUsed: number;
	resolvedBy?: string;
	evalPassed?: boolean | null;
	evalStateValues?: Record<string, unknown>;
	evalMismatches?: Array<{ key: string; expected: unknown; actual: unknown }>;
	skipped?: boolean;
	error?: string;
}

export interface GoalStepResult {
	step: number;
	action: string;
	reasoning: string;
	result: string;
	package: string;
	durationMs: number;
}

export interface GoalStepsResult {
	steps: GoalStepResult[];
	totalSteps: number;
}

export interface GoalEvalResult {
	definition: Record<string, unknown> | null;
	judgment: {
		success: boolean;
		stateValues: Record<string, unknown>;
		mismatches: Array<{ key: string; expected: unknown; actual: unknown }>;
	} | null;
}

export class DroidClawTestClient {
	private baseUrl: string;
	private authToken: string;
	private deviceId: string;

	constructor(baseUrl: string, authToken: string, deviceId: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.authToken = authToken;
		this.deviceId = deviceId;
	}

	/**
	 * Queue a workflow from a JSON file with variable substitution.
	 */
	async runWorkflow(
		filePath: string,
		variables?: Record<string, string>,
	): Promise<{ runId: string }> {
		const absPath = resolve(filePath);
		const workflow = JSON.parse(readFileSync(absPath, "utf-8"));

		const body: Record<string, unknown> = {
			name: workflow.name ?? "E2E Test Workflow",
			steps: workflow.steps,
		};

		// Merge file-level variables with overrides
		if (workflow.variables || variables) {
			body.variables = { ...(workflow.variables ?? {}), ...(variables ?? {}) };
		}

		const res = await fetch(
			`${this.baseUrl}/v2/devices/${this.deviceId}/workflows/run`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...this.authHeaders(),
				},
				body: JSON.stringify(body),
			},
		);

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
			throw new Error(
				`Failed to queue workflow: ${(err as Record<string, string>).error ?? res.status}`,
			);
		}

		const data = (await res.json()) as { runId: string; status: string };
		return { runId: data.runId };
	}

	/**
	 * Queue a workflow from inline steps (no JSON file).
	 */
	async runInlineWorkflow(
		name: string,
		steps: Record<string, unknown>[],
		variables?: Record<string, string>,
	): Promise<{ runId: string }> {
		const body: Record<string, unknown> = { name, steps };
		if (variables) body.variables = variables;

		const res = await fetch(
			`${this.baseUrl}/v2/devices/${this.deviceId}/workflows/run`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...this.authHeaders(),
				},
				body: JSON.stringify(body),
			},
		);

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
			throw new Error(
				`Failed to queue workflow: ${(err as Record<string, string>).error ?? res.status}`,
			);
		}

		const data = (await res.json()) as { runId: string; status: string };
		return { runId: data.runId };
	}

	/**
	 * Poll for workflow completion with timeout.
	 * Returns structured result when done.
	 */
	async waitForCompletion(
		runId: string,
		timeoutMs = 5 * 60 * 1000,
		pollIntervalMs = 5_000,
	): Promise<WorkflowRunResult> {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const result = await this.getRunStatus(runId);

			if (result.status === "completed" || result.status === "failed" || result.status === "stopped") {
				return result;
			}

			// Log progress
			const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
			const currentGoal = result.goals.find((g) => g.status === "running");
			console.log(
				`[${elapsed}s] Run ${runId.slice(0, 8)}... status=${result.status} step=${result.currentStep}/${result.totalSteps}${currentGoal ? ` goal="${currentGoal.goal.slice(0, 60)}..."` : ""}`,
			);

			await new Promise((r) => setTimeout(r, pollIntervalMs));
		}

		throw new Error(
			`Workflow ${runId} did not complete within ${Math.round(timeoutMs / 1000)}s`,
		);
	}

	/**
	 * Get current run status with goal-level detail.
	 */
	async getRunStatus(runId: string): Promise<WorkflowRunResult> {
		const res = await fetch(
			`${this.baseUrl}/v2/devices/${this.deviceId}/workflows/runs/${runId}`,
			{
				headers: this.authHeaders(),
			},
		);

		if (!res.ok) {
			throw new Error(`Failed to get run status: HTTP ${res.status}`);
		}

		const data = (await res.json()) as Record<string, unknown>;
		const goals = (data.goals ?? []) as Array<Record<string, unknown>>;

		return {
			runId: (data.runId as string) ?? runId,
			status: data.status as string,
			name: (data.name as string) ?? "",
			totalSteps: (data.totalSteps as number) ?? 0,
			currentStep: (data.currentStep as number | null) ?? null,
			goals: goals.map((g) => ({
				goalId: (g.goalId as string) ?? (g.stepId as string) ?? "",
				goal: (g.text as string) ?? (g.goal as string) ?? "",
				status: (g.status as string) ?? "unknown",
				success: (g.success as boolean) ?? false,
				stepsUsed: (g.stepsUsed as number) ?? 0,
				resolvedBy: g.resolvedBy as string | undefined,
				evalPassed: g.evalPassed as boolean | null | undefined,
				evalStateValues: g.evalStateValues as Record<string, unknown> | undefined,
				evalMismatches: g.evalMismatches as Array<{ key: string; expected: unknown; actual: unknown }> | undefined,
				skipped: (g.skipped as boolean) ?? false,
				error: g.error as string | undefined,
			})),
			startedAt: (data.startedAt as string) ?? "",
			completedAt: (data.completedAt as string | null) ?? null,
			durationMs: (data.durationMs as number | null) ?? null,
		};
	}

	/**
	 * Stop a running workflow.
	 */
	async stopWorkflow(runId: string): Promise<void> {
		await fetch(
			`${this.baseUrl}/v2/devices/${this.deviceId}/workflows/runs/${runId}/stop`,
			{
				method: "POST",
				headers: this.authHeaders(),
			},
		);
	}

	/**
	 * List devices visible to this auth token.
	 */
	async listDevices(): Promise<Array<{ deviceId: string; name: string; online: boolean }>> {
		const res = await fetch(`${this.baseUrl}/v2/devices`, {
			headers: this.authHeaders(),
		});
		if (!res.ok) throw new Error(`Failed to list devices: HTTP ${res.status}`);
		return (await res.json()) as Array<{ deviceId: string; name: string; online: boolean }>;
	}

	/**
	 * Get agent steps for a specific goal in a run.
	 */
	async getGoalSteps(
		runId: string,
		goalId: string,
		options?: { from?: number; to?: number },
	): Promise<GoalStepsResult> {
		const params = new URLSearchParams();
		if (options?.from) params.set("from", String(options.from));
		if (options?.to) params.set("to", String(options.to));
		const qs = params.toString() ? `?${params.toString()}` : "";

		const res = await fetch(
			`${this.baseUrl}/v2/devices/${this.deviceId}/workflows/runs/${runId}/goals/${goalId}/steps${qs}`,
			{ headers: this.authHeaders() },
		);

		if (!res.ok) {
			throw new Error(`Failed to get goal steps: HTTP ${res.status}`);
		}

		return (await res.json()) as GoalStepsResult;
	}

	/**
	 * Get eval definition and judgment for a specific goal in a run.
	 */
	async getGoalEval(runId: string, goalId: string): Promise<GoalEvalResult> {
		const res = await fetch(
			`${this.baseUrl}/v2/devices/${this.deviceId}/workflows/runs/${runId}/goals/${goalId}/eval`,
			{ headers: this.authHeaders() },
		);

		if (!res.ok) {
			throw new Error(`Failed to get goal eval: HTTP ${res.status}`);
		}

		return (await res.json()) as GoalEvalResult;
	}

	private authHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.authToken}`,
		};
	}
}
