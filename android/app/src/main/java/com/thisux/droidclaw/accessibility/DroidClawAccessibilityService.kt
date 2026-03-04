package com.thisux.droidclaw.accessibility

import android.accessibilityservice.AccessibilityService
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import com.thisux.droidclaw.model.UIElement
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking

class DroidClawAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "DroidClawA11y"
        val isRunning = MutableStateFlow(false)
        val lastScreenTree = MutableStateFlow<List<UIElement>>(emptyList())
        var instance: DroidClawAccessibilityService? = null

        /** The last known Activity class name (from TYPE_WINDOW_STATE_CHANGED or UsageStats) */
        var currentActivityName: String? = null

        fun isEnabledOnDevice(context: Context): Boolean {
            val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            val ourComponent = ComponentName(context, DroidClawAccessibilityService::class.java)
            return am.getEnabledAccessibilityServiceList(AccessibilityEvent.TYPES_ALL_MASK)
                .any { it.resolveInfo.serviceInfo.let { si ->
                    ComponentName(si.packageName, si.name) == ourComponent
                }}
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "Accessibility service connected")
        instance = this
        isRunning.value = true
        disableAutofill()
    }

    /**
     * Disable the system autofill service to prevent credential manager / autofill
     * popups from appearing when the agent types into text fields.
     * Uses 'settings put' which works without root on managed devices (Esper).
     */
    private fun disableAutofill() {
        try {
            Runtime.getRuntime().exec(arrayOf("settings", "put", "secure", "autofill_service", ""))
            Log.i(TAG, "Autofill service disabled via settings")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to disable autofill: ${e.message}")
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Track the current Activity name from window state changes
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val className = event.className?.toString()
            val pkgName = event.packageName?.toString()
            Log.d(TAG, "TYPE_WINDOW_STATE_CHANGED: className=$className pkg=$pkgName")

            // Auto-dismiss autofill / credential manager popups
            if (isAutofillPopup(pkgName, className)) {
                Log.i(TAG, "Dismissing autofill/credential popup: pkg=$pkgName class=$className")
                performGlobalAction(GLOBAL_ACTION_BACK)
                return
            }

            // Only update if it looks like an Activity (contains a dot — package-qualified class name)
            // This filters out things like "android.widget.PopupWindow" from dialogs
            if (className != null && className.contains('.') && !className.startsWith("android.widget.") && !className.startsWith("android.view.")) {
                currentActivityName = className
                Log.i(TAG, "Activity updated (event): $currentActivityName")
            }
        }
    }

    /** Check if a window event comes from an autofill or credential manager popup */
    private fun isAutofillPopup(pkgName: String?, className: String?): Boolean {
        if (pkgName == null) return false
        // Known autofill/credential manager packages
        val autofillPackages = setOf(
            "com.google.android.gms",           // Google Credential Manager / Autofill
            "com.samsung.android.autofill",      // Samsung Autofill
            "com.samsung.android.vaultkeeper",   // Samsung Pass / Vault
            "com.samsung.android.samsungpass",   // Samsung Pass
            "com.samsung.android.samsungpassautofill",
        )
        // Match by package
        if (pkgName in autofillPackages) {
            // Only dismiss if it looks like an autofill/credential UI, not regular GMS
            val isAutofillClass = className?.let { cn ->
                cn.contains("autofill", ignoreCase = true) ||
                cn.contains("credential", ignoreCase = true) ||
                cn.contains("password", ignoreCase = true) ||
                cn.contains("Fido", ignoreCase = true) ||
                cn.contains("SavePassword", ignoreCase = true) ||
                cn.contains("CredentialProvider", ignoreCase = true) ||
                cn.contains("HalfSheetActivity", ignoreCase = true) ||
                cn.contains("BottomSheet", ignoreCase = true)
            } ?: false
            // For Samsung autofill-specific packages, always dismiss
            if (pkgName != "com.google.android.gms") return true
            return isAutofillClass
        }
        return false
    }

    /**
     * Query UsageStatsManager to find the most recent Activity class name.
     * Requires PACKAGE_USAGE_STATS permission (App usage access in Settings).
     * Falls back gracefully if not granted.
     */
    fun queryCurrentActivityFromUsageStats(): String? {
        try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
            val now = System.currentTimeMillis()
            // Query events in the last 5 seconds
            val events = usm.queryEvents(now - 5_000, now)
            val event = UsageEvents.Event()
            var lastActivity: String? = null
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                    lastActivity = event.className
                }
            }
            if (lastActivity != null) {
                Log.d(TAG, "UsageStats activity: $lastActivity")
            }
            return lastActivity
        } catch (e: Exception) {
            Log.w(TAG, "UsageStats query failed: ${e.message}")
            return null
        }
    }

    /**
     * Get current activity name. Tries:
     * 1. The cached value from accessibility events
     * 2. UsageStatsManager (if permission granted)
     * 3. Active window title from accessibility windows API
     */
    fun getCurrentActivity(): String? {
        // First try: cached from accessibility events (fastest, most reliable)
        currentActivityName?.let { return it }

        // Second try: UsageStats (requires special permission, but very accurate)
        queryCurrentActivityFromUsageStats()?.let {
            currentActivityName = it
            return it
        }

        // Third try: Extract from windows API
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val activeWindows = windows
                for (window in activeWindows) {
                    if (window.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION) {
                        val title = window.title?.toString()
                        if (title != null) {
                            Log.d(TAG, "Window title: $title")
                            return title
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Windows API failed: ${e.message}")
        }

        return null
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Accessibility service destroyed")
        instance = null
        isRunning.value = false
    }

    fun getScreenTree(): List<UIElement> {
        // Retry with increasing delays — apps like Contacts on Vivo
        // can take 500ms+ to render after a cold launch
        val delays = longArrayOf(50, 100, 200, 300, 500)
        for (delayMs in delays) {
            val elements = captureAllWindows()
            if (elements.isNotEmpty()) {
                lastScreenTree.value = elements
                return elements
            }
            // Fallback: try rootInActiveWindow (in case windows API fails)
            val root = rootInActiveWindow
            if (root != null) {
                try {
                    val fallback = ScreenTreeBuilder.capture(root)
                    if (fallback.isNotEmpty()) {
                        lastScreenTree.value = fallback
                        return fallback
                    }
                } finally {
                    root.recycle()
                }
            }
            runBlocking { delay(delayMs) }
        }
        Log.w(TAG, "rootInActiveWindow null or empty after retries")
        return emptyList()
    }

    /**
     * Walk ALL accessible windows (application, system, input method, etc.)
     * and merge their element trees. This captures bottom nav bars, dialogs,
     * and other UI layers that rootInActiveWindow alone would miss.
     */
    private fun captureAllWindows(): List<UIElement> {
        val allElements = mutableListOf<UIElement>()
        try {
            val allWindows = windows ?: return emptyList()
            for (window in allWindows) {
                // Capture application windows and system windows (nav bars)
                // Skip input method windows (keyboard) to reduce noise
                if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
                val root = window.root ?: continue
                try {
                    val windowElements = ScreenTreeBuilder.capture(root)
                    allElements.addAll(windowElements)
                } finally {
                    root.recycle()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "captureAllWindows failed: ${e.message}")
        }
        return allElements
    }

    fun findNodeAt(x: Int, y: Int): AccessibilityNodeInfo? {
        // Search ALL windows, preferring focused/active windows first.
        // This ensures taps on overlays (bottom sheets, dialogs) hit the overlay
        // element rather than a background element at the same coordinates.
        try {
            val allWindows = windows
            if (allWindows != null && allWindows.isNotEmpty()) {
                // Partition: focused/active windows first, then the rest
                val focused = mutableListOf<AccessibilityWindowInfo>()
                val background = mutableListOf<AccessibilityWindowInfo>()
                for (window in allWindows) {
                    if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
                    if (window.isFocused || window.isActive) {
                        focused.add(window)
                    } else {
                        background.add(window)
                    }
                }
                // Search focused/active windows first, then background
                for (window in focused + background) {
                    val root = window.root ?: continue
                    try {
                        val found = findNodeAtRecursive(root, x, y)
                        if (found != null) return found
                    } catch (_: Exception) {
                        // Window may have been closed during traversal
                    }
                }
                return null
            }
        } catch (_: Exception) {
            // Fallback to rootInActiveWindow
        }

        // Fallback: single-window search (pre-API 21 or if windows API fails)
        val root = rootInActiveWindow ?: return null
        return findNodeAtRecursive(root, x, y)
    }

    private fun findNodeAtRecursive(
        node: AccessibilityNodeInfo,
        x: Int,
        y: Int
    ): AccessibilityNodeInfo? {
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)

        if (!rect.contains(x, y)) {
            node.recycle()
            return null
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNodeAtRecursive(child, x, y)
            if (found != null) {
                node.recycle()
                return found
            }
        }

        return if (node.isClickable || node.isLongClickable || node.isEditable) {
            node
        } else {
            node.recycle()
            null
        }
    }
}
