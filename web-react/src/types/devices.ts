/** Shared types for device dashboard components */

export interface Session {
	id: string;
	goal: string;
	status: string;
	stepsUsed: number | null;
	startedAt: Date;
	completedAt: Date | null;
	scheduledFor: Date | null;
	scheduledDelay: number | null;
}

export interface Step {
	id: string;
	stepNumber: number;
	action: unknown;
	reasoning: string | null;
	result: string | null;
}

export interface WorkflowStepConfig {
	goal: string;
	app?: string;
	maxSteps?: number;
	retries?: number;
	cache?: boolean;
	forceStop?: boolean;
	eval?: Record<string, unknown>;
}

export interface AgentStepDetail {
	id: string;
	stepNumber: number;
	action: unknown;
	reasoning: string | null;
	result: string | null;
	packageName?: string;
	durationMs?: number;
}

export interface StepResult {
	goal?: string;
	goalId?: string;
	command?: string;
	success: boolean;
	stepsUsed?: number;
	sessionId?: string;
	resolvedBy?: "agent" | "cached_flow" | "discovery" | "recipe" | "parser" | "classifier";
	message?: string;
	error?: string;
	evalPassed?: boolean | null;
	skipped?: boolean;
	observations?: Array<{
		stepNumber?: number;
		elements: unknown[];
		packageName?: string;
		activityName?: string;
	}>;
	agentSteps?: AgentStepDetail[];
}

export interface EvalDefinition {
	states: Record<string, {
		type: string;
		description: string;
		expected?: unknown;
	}>;
}

export interface EvalJudgment {
	success: boolean;
	stateValues: Record<string, unknown>;
	mismatches: Array<{ key: string; actual: unknown; expected: unknown }>;
	trackedOnly: Record<string, unknown>;
}

export interface EvalResult {
	goal: number;
	goalId: string;
	definition: EvalDefinition;
	judgment: EvalJudgment | null;
}

export interface WorkflowRun {
	id: string;
	name: string;
	type: string;
	status: string;
	totalSteps: number;
	currentStep: number | null;
	steps: Array<WorkflowStepConfig | string | Record<string, unknown>>;
	stepResults: StepResult[] | null;
	startedAt: Date;
	completedAt: Date | null;
}

export interface WorkflowLiveProgress {
	activeStepIndex: number;
	activeStepGoal: string;
	attempt: number;
	totalAttempts: number;
	stepsUsedInAttempt: number;
}

export interface LiveAgentStep {
	step: number;
	action: string;
	reasoning: string;
}

export interface LiveWorkflowRun {
	runId: string;
	name: string;
	wfType: string;
	totalSteps: number;
	stepGoals: Array<{ goal: string; app?: string }>;
	status: 'running' | 'completed' | 'failed' | 'stopped';
	stepResults: Array<{
		success: boolean;
		stepsUsed?: number;
		resolvedBy?: "agent" | "cached_flow" | "discovery" | "recipe" | "parser" | "classifier";
		error?: string;
		message?: string;
	} | null>;
	activeStepIndex: number;
	attempt: number;
	totalAttempts: number;
	liveSteps: LiveAgentStep[];
}

export interface CachedFlowEntry {
	id: string;
	goalKey: string;
	appPackage: string | null;
	stepCount: number;
	successCount: number | null;
	failCount: number | null;
	createdAt: Date;
	lastUsedAt: Date | null;
}

export interface DeviceData {
	deviceId: string;
	name: string;
	status: string;
	model: string | null;
	manufacturer: string | null;
	androidVersion: string | null;
	screenWidth: number | null;
	screenHeight: number | null;
	batteryLevel: number | null;
	isCharging: boolean;
	lastSeen: string;
	installedApps: Array<{ packageName: string; label: string }>;
}

export interface QueueItem {
	runId: string;
	name: string;
	type: string;
	totalSteps: number;
	scheduledFor: string | null;
}

export interface QueueState {
	running: WorkflowRun | null;
	queued: QueueItem[];
}

// ── Goals-First Redesign Types ──

/** Saved goal template */
export interface Goal {
	id: string;
	name: string;
	app?: string;
	maxSteps?: number;
	retries?: number;
	cache?: boolean;
	eval?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

/** Saved workflow template */
export interface Workflow {
	id: string;
	name: string;
	steps: WorkflowStepConfig[];
	variables?: Record<string, string>;
	createdAt: string;
	updatedAt: string;
}

/** Goal run execution record */
export interface GoalRun {
	id: string;
	goalId?: string;
	workflowRunId?: string;
	stepIndex?: number;
	goal: string;
	app?: string;
	status: "running" | "completed" | "failed" | "skipped";
	resolvedBy?: "discovery" | "recipe" | "parser" | "classifier";
	recipeId?: string;
	stepsUsed: number;
	durationMs?: number;
	evalPassed?: boolean;
	evalStateValues?: Record<string, unknown>;
	evalMismatches?: Array<{ key: string; expected: unknown; actual: unknown }>;
	startedAt: string;
	completedAt?: string;
}

/** Recipe entry (compiled replay) */
export interface RecipeEntry {
	id: string;
	goalKey: string;
	appPackage?: string;
	stepCount: number;
	active: boolean;
	successCount: number;
	failCount: number;
	createdAt: string;
	lastUsedAt?: string;
}
