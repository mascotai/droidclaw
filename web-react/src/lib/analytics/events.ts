/**
 * Centralized Umami analytics event names.
 * Naming convention: {category}-{action}
 */

// Auth
// (auth handled by authentik - no client-side auth events)

// License / Conversion
export const LICENSE_ACTIVATE_CHECKOUT = 'license-activate-checkout';
export const LICENSE_ACTIVATE_MANUAL = 'license-activate-manual';
export const LICENSE_PURCHASE_CLICK = 'license-purchase-click';

// Dashboard
export const DASHBOARD_CARD_CLICK = 'dashboard-card-click';

// Devices
export const DEVICE_CARD_CLICK = 'device-card-click';
export const DEVICE_TAB_CHANGE = 'device-tab-change';
export const DEVICE_GOAL_SUBMIT = 'device-goal-submit';
export const DEVICE_GOAL_STOP = 'device-goal-stop';
export const DEVICE_GOAL_COMPLETE = 'device-goal-complete';
export const DEVICE_SESSION_EXPAND = 'device-session-expand';
export const DEVICE_WORKFLOW_EXPAND = 'device-workflow-expand';
export const DEVICE_WORKFLOW_SUBMIT = 'device-workflow-submit';
export const DEVICE_WORKFLOW_STOP = 'device-workflow-stop';
export const DEVICE_CACHED_FLOW_RUN = 'device-cached-flow-run';
export const DEVICE_CACHED_FLOW_DELETE = 'device-cached-flow-delete';
export const DEVICE_CACHED_FLOW_COMPILED = 'device-cached-flow-compiled';

// Settings
export const SETTINGS_SAVE = 'settings-save';

// Navigation
export const NAV_SIDEBAR_CLICK = 'nav-sidebar-click';
