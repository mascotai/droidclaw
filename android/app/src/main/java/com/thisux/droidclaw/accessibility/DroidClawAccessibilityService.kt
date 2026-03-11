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
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val eventType = event?.eventType ?: return
        val className = event.className?.toString()

        // Track the current Activity name from window state changes
        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            // Only update if it looks like an Activity (contains a dot — package-qualified class name)
            // This filters out things like "android.widget.PopupWindow" from dialogs
            if (className != null && className.contains('.') && !className.startsWith("android.widget.") && !className.startsWith("android.view.")) {
                currentActivityName = className
                Log.i(TAG, "Activity updated (event): $currentActivityName")
            }
        }
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

    // ── Overlay / keyboard packages to auto-dismiss before screen capture ──

    /** Autofill & credential manager packages that show bottom sheets */
    private val overlayPackages = setOf(
        "com.samsung.android.autofill",
        "com.samsung.android.vaultkeeper",
        "com.samsung.android.samsungpass",
        "com.samsung.android.samsungpassautofill",
        "com.samsung.android.clipboarduiservice",
        "com.samsung.android.clipboardsaveservice",
    )

    /** GMS shows many things — only treat these class-name fragments as overlays */
    private val gmsOverlayClassFragments = listOf(
        "autofill", "credential", "password", "fido",
        "savepassword", "credentialprovider", "halfsheetactivity", "bottomsheet"
    )

    /** Samsung keyboard clipboard/suggestion panels */
    private val honeyboardOverlayFragments = listOf(
        "clipboard", "suggestion", "popupwindow", "bottomsheet", "floatingtoolbar"
    )

    /**
     * Check if a soft keyboard (input method) window is currently visible.
     */
    private fun isKeyboardVisible(): Boolean {
        try {
            val allWindows = windows ?: return false
            for (window in allWindows) {
                if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
                    return true
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "isKeyboardVisible check failed: ${e.message}")
        }
        return false
    }

    /**
     * Check visible windows for overlay popups (autofill, credential managers,
     * Samsung clipboard, etc.) that should be dismissed before screen capture.
     */
    private fun findOverlayWindow(): AccessibilityWindowInfo? {
        try {
            val allWindows = windows ?: return null
            for (window in allWindows) {
                if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
                if (window.type == AccessibilityWindowInfo.TYPE_APPLICATION) continue

                val root = window.root ?: continue
                val pkg = root.packageName?.toString()
                root.recycle()

                if (pkg == null) continue

                // Known overlay packages — always dismiss
                if (pkg in overlayPackages) {
                    Log.d(TAG, "Overlay detected: $pkg")
                    return window
                }

                // Google GMS — only if the window looks like autofill/credential UI
                if (pkg == "com.google.android.gms") {
                    // Check if any node text hints at autofill
                    val windowRoot = window.root ?: continue
                    try {
                        if (hasOverlayContent(windowRoot, gmsOverlayClassFragments)) {
                            Log.d(TAG, "GMS autofill overlay detected")
                            return window
                        }
                    } finally {
                        windowRoot.recycle()
                    }
                }

                // Samsung keyboard clipboard/suggestion panels
                if (pkg == "com.samsung.android.honeyboard") {
                    val windowRoot = window.root ?: continue
                    try {
                        if (hasOverlayContent(windowRoot, honeyboardOverlayFragments)) {
                            Log.d(TAG, "Samsung keyboard overlay detected")
                            return window
                        }
                    } finally {
                        windowRoot.recycle()
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "findOverlayWindow failed: ${e.message}")
        }
        return null
    }

    /**
     * Quick check: does any node's className contain one of the given fragments?
     * Used to identify GMS/honeyboard overlays without false positives.
     */
    private fun hasOverlayContent(node: AccessibilityNodeInfo, fragments: List<String>): Boolean {
        val cn = node.className?.toString()?.lowercase() ?: ""
        for (f in fragments) {
            if (cn.contains(f)) return true
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                if (hasOverlayContent(child, fragments)) return true
            } finally {
                child.recycle()
            }
        }
        return false
    }

    fun getScreenTree(): List<UIElement> {
        // ── Clean the screen before capturing ──
        // Dismiss keyboard — it shifts element positions, making coordinate-based
        // taps unreliable for the agent.
        if (isKeyboardVisible()) {
            Log.i(TAG, "Keyboard visible, dismissing before screen capture")
            performGlobalAction(GLOBAL_ACTION_BACK)
            runBlocking { delay(300) }
        }

        // Dismiss overlay popups (autofill, credential managers, Samsung clipboard)
        // that obscure the app and confuse the agent.
        if (findOverlayWindow() != null) {
            Log.i(TAG, "Overlay popup detected, dismissing before screen capture")
            performGlobalAction(GLOBAL_ACTION_BACK)
            runBlocking { delay(400) }
        }

        // Phase 1: Normal retries with short delays — covers most cases
        // (apps like Contacts on Vivo can take 500ms+ to render after cold launch)
        val normalDelays = longArrayOf(50, 100, 200, 300, 500)
        for (delayMs in normalDelays) {
            val capture = captureAllWindows()
            if (capture.elements.isNotEmpty() && capture.hasAppWindow) {
                lastScreenTree.value = capture.elements
                return capture.elements
            }
            // Fallback: try rootInActiveWindow (in case windows API fails)
            val root = rootInActiveWindow
            if (root != null) {
                try {
                    val pkg = root.packageName?.toString()
                    val isAppRoot = pkg != null && pkg !in systemUiPackages
                    val fallback = ScreenTreeBuilder.capture(root)
                    if (fallback.isNotEmpty() && isAppRoot) {
                        lastScreenTree.value = fallback
                        return fallback
                    }
                } finally {
                    root.recycle()
                }
            }
            runBlocking { delay(delayMs) }
        }

        // Phase 2: Extended retries for slow transitions (e.g. Instagram login)
        // If we got elements but no app window, the app is mid-transition.
        // Wait longer with bigger delays before giving up.
        val extendedDelays = longArrayOf(500, 1000, 1500, 2000)
        for (delayMs in extendedDelays) {
            Log.i(TAG, "No app window found, extended retry (${delayMs}ms)")
            runBlocking { delay(delayMs) }
            val capture = captureAllWindows()
            if (capture.elements.isNotEmpty() && capture.hasAppWindow) {
                Log.i(TAG, "App window found after extended retry")
                lastScreenTree.value = capture.elements
                return capture.elements
            }
        }

        // Phase 3: Give up on app window requirement — return whatever we have.
        // This is the fallback for edge cases like the home screen where the
        // launcher may not register as TYPE_APPLICATION on some devices.
        Log.w(TAG, "No app window found after all retries, returning best-effort capture")
        val lastCapture = captureAllWindows()
        if (lastCapture.elements.isNotEmpty()) {
            lastScreenTree.value = lastCapture.elements
            return lastCapture.elements
        }

        // Final fallback: rootInActiveWindow
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

        Log.w(TAG, "rootInActiveWindow null or empty after all retries")
        return emptyList()
    }

    /** Result of captureAllWindows — includes whether any app window contributed elements */
    private data class CaptureResult(
        val elements: List<UIElement>,
        val hasAppWindow: Boolean
    )

    /** System UI packages whose elements alone don't constitute a valid capture.
     *  When the screen only contains elements from these packages, the app
     *  window likely hasn't rendered yet and we should retry. */
    private val systemUiPackages = setOf(
        "com.android.systemui",
        "com.android.launcher",
        "com.sec.android.app.launcher",        // Samsung launcher (older)
        "com.samsung.android.app.launcher",    // Samsung launcher (newer)
        "com.google.android.apps.nexuslauncher", // Pixel launcher
        "com.huawei.android.launcher",         // Huawei launcher
    )

    /**
     * Walk ALL accessible windows (application, system, input method, etc.)
     * and merge their element trees. This captures bottom nav bars, dialogs,
     * and other UI layers that rootInActiveWindow alone would miss.
     *
     * Returns a CaptureResult that also indicates whether any TYPE_APPLICATION
     * window contributed elements. When only system windows are captured (status
     * bar, nav bar), the caller should retry — the app window likely hasn't
     * rendered its accessibility tree yet after a transition.
     */
    private fun captureAllWindows(): CaptureResult {
        val allElements = mutableListOf<UIElement>()
        var hasAppWindow = false
        try {
            val allWindows = windows ?: return CaptureResult(emptyList(), false)
            Log.d(TAG, "captureAllWindows: ${allWindows.size} windows")
            for (window in allWindows) {
                // Skip input method windows (keyboard) to reduce noise
                // and prevent keyboard elements from confusing the agent
                if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue

                val windowPkg = window.root?.packageName?.toString() ?: "null"

                // Skip known overlay packages (autofill, credential managers, clipboard)
                if (windowPkg in overlayPackages) {
                    Log.d(TAG, "  window pkg=$windowPkg -> skipped (overlay)")
                    continue
                }
                val windowType = window.type
                val windowLayer = window.layer
                val root = window.root
                if (root == null) {
                    Log.d(TAG, "  window pkg=$windowPkg type=$windowType layer=$windowLayer -> root is null, skipping")
                    continue
                }
                try {
                    val windowElements = ScreenTreeBuilder.capture(root)
                    Log.d(TAG, "  window pkg=$windowPkg type=$windowType layer=$windowLayer -> ${windowElements.size} elements")
                    allElements.addAll(windowElements)

                    // Track if a real application window contributed elements
                    if (windowType == AccessibilityWindowInfo.TYPE_APPLICATION &&
                        windowElements.isNotEmpty() &&
                        windowPkg !in systemUiPackages) {
                        hasAppWindow = true
                    }
                } finally {
                    root.recycle()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "captureAllWindows failed: ${e.message}")
        }
        return CaptureResult(allElements, hasAppWindow)
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
