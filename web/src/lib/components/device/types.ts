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

export interface StepResult {
	goal?: string;
	command?: string;
	success: boolean;
	stepsUsed?: number;
	sessionId?: string;
	resolvedBy?: string;
	message?: string;
	error?: string;
	observations?: Array<{
		stepNumber?: number;
		elements: unknown[];
		packageName?: string;
		activityName?: string;
	}>;
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
		resolvedBy?: string;
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
