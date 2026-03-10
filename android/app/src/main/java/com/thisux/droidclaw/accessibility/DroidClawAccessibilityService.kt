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
        disableSystemPopups()
    }

    /**
     * Disable system services that produce popups interfering with automation.
     * Uses 'settings put' which works without root on managed devices (Esper).
     *
     * Disables:
     * - Autofill service: prevents autofill/password popups on text fields
     * - Credential manager: prevents Google/Samsung credential selector half-sheets
     * - Credential manager for Samsung: Samsung-specific credential service
     */
    private fun disableSystemPopups() {
        val settings = mapOf(
            "autofill_service" to "",                   // Disable autofill popups
            "credential_service" to "",                 // Disable Android Credential Manager
            "credential_service_primary" to "",         // Disable primary credential provider
        )
        for ((key, value) in settings) {
            try {
                Runtime.getRuntime().exec(arrayOf("settings", "put", "secure", key, value))
                Log.i(TAG, "Disabled system popup: $key")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to disable $key: ${e.message}")
            }
        }

        // Also force-stop the credential manager package to clear any existing state
        try {
            Runtime.getRuntime().exec(arrayOf("am", "force-stop", "com.android.credentialmanager"))
            Runtime.getRuntime().exec(arrayOf("am", "force-stop", "com.google.android.gms"))
            Log.i(TAG, "Force-stopped credential manager packages on startup")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to force-stop credential packages: ${e.message}")
        }
    }

    /** Debounce: track last dismiss time to avoid spamming BACK */
    private var lastDismissTimeMs = 0L
    private val DISMISS_COOLDOWN_MS = 800L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val eventType = event?.eventType ?: return
        val pkgName = event.packageName?.toString()
        val className = event.className?.toString()

        // ── Auto-dismiss overlays on any relevant event type ──
        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {

            if (shouldDismissOverlay(pkgName, className, eventType)) {
                val now = System.currentTimeMillis()
                if (now - lastDismissTimeMs > DISMISS_COOLDOWN_MS) {
                    Log.i(TAG, "Dismissing overlay: pkg=$pkgName class=$className event=${eventTypeName(eventType)}")
                    lastDismissTimeMs = now
                    // Try multiple dismiss strategies
                    dismissOverlay(pkgName)
                }
                return
            }
        }

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

    private fun eventTypeName(type: Int): String = when (type) {
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "STATE_CHANGED"
        AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "CONTENT_CHANGED"
        AccessibilityEvent.TYPE_VIEW_FOCUSED -> "VIEW_FOCUSED"
        else -> "type=$type"
    }

    /**
     * Determine if a window event is from an overlay we should auto-dismiss.
     * Covers: autofill popups, credential managers, Samsung clipboard panel,
     * Samsung keyboard suggestions, and other half-sheet overlays.
     */
    private fun shouldDismissOverlay(pkgName: String?, className: String?, eventType: Int): Boolean {
        if (pkgName == null) return false

        // ── 1. Autofill / Credential Manager packages ──
        val autofillPackages = setOf(
            "com.google.android.gms",           // Google Credential Manager / Autofill
            "com.android.credentialmanager",     // Android system Credential Manager (CredentialSelectorActivity)
            "com.samsung.android.autofill",      // Samsung Autofill
            "com.samsung.android.vaultkeeper",   // Samsung Pass / Vault
            "com.samsung.android.samsungpass",   // Samsung Pass
            "com.samsung.android.samsungpassautofill",
        )

        if (pkgName in autofillPackages) {
            // For Samsung autofill-specific packages, always dismiss
            if (pkgName != "com.google.android.gms") return true
            // For Google GMS, only dismiss if it looks like an autofill/credential UI
            return className?.let { cn ->
                cn.contains("autofill", ignoreCase = true) ||
                cn.contains("credential", ignoreCase = true) ||
                cn.contains("password", ignoreCase = true) ||
                cn.contains("Fido", ignoreCase = true) ||
                cn.contains("SavePassword", ignoreCase = true) ||
                cn.contains("CredentialProvider", ignoreCase = true) ||
                cn.contains("HalfSheetActivity", ignoreCase = true) ||
                cn.contains("BottomSheet", ignoreCase = true)
            } ?: false
        }

        // ── 2. Samsung Keyboard clipboard panel & suggestions ──
        // Samsung Keyboard (Honeyboard) shows a clipboard popover when you tap a text field
        // after a clipboard_set. It also shows autocomplete suggestions as an overlay.
        if (pkgName == "com.samsung.android.honeyboard") {
            // Only dismiss on STATE_CHANGED (new window/panel opened), not every content change
            // (content changes happen constantly as you type — we don't want to dismiss the keyboard itself)
            if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                val isClipboardOrSuggestion = className?.let { cn ->
                    cn.contains("Clipboard", ignoreCase = true) ||
                    cn.contains("Suggestion", ignoreCase = true) ||
                    cn.contains("PopupWindow", ignoreCase = true) ||
                    cn.contains("BottomSheet", ignoreCase = true) ||
                    cn.contains("FloatingToolbar", ignoreCase = true)
                } ?: false
                if (isClipboardOrSuggestion) return true
            }
        }

        // ── 3. Samsung Clipboard edge panel ──
        if (pkgName == "com.samsung.android.clipboarduiservice" ||
            pkgName == "com.samsung.android.clipboardsaveservice") {
            return true
        }

        // ── 4. Generic overlay class name patterns (any package) ──
        // Some overlays appear from the app's own package (e.g. Instagram's autofill suggestion)
        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && className != null) {
            // Credential/autofill-related class names from any package
            val isCredentialOverlay =
                className.contains("CredentialProviderHalfSheet", ignoreCase = true) ||
                className.contains("CredentialAutofill", ignoreCase = true) ||
                className.contains("AutofillPopup", ignoreCase = true)
            if (isCredentialOverlay) return true
        }

        return false
    }

    /**
     * Dismiss an overlay by force-stopping its package.
     * This cleanly removes the overlay activity from the window stack without
     * side effects (no BACK navigation, no notification shade).
     *
     * `am force-stop` works without root on Esper-managed devices.
     */
    private fun dismissOverlay(pkgName: String?) {
        if (pkgName == null) return
        try {
            Runtime.getRuntime().exec(arrayOf("am", "force-stop", pkgName))
            Log.i(TAG, "Force-stopped overlay package: $pkgName")
        } catch (e: Exception) {
            Log.w(TAG, "force-stop failed for $pkgName: ${e.message}")
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

                // Skip overlay windows from known popup/clipboard packages
                val windowPkg = window.root?.packageName?.toString()
                if (windowPkg != null && isOverlayPackage(windowPkg)) {
                    Log.d(TAG, "captureAllWindows: skipping overlay window from $windowPkg")
                    continue
                }

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

    /** Packages whose overlay windows should be excluded from the screen tree */
    private fun isOverlayPackage(pkgName: String): Boolean {
        val overlayPackages = setOf(
            "com.samsung.android.clipboarduiservice",
            "com.samsung.android.clipboardsaveservice",
            "com.samsung.android.autofill",
            "com.samsung.android.vaultkeeper",
            "com.samsung.android.samsungpass",
            "com.samsung.android.samsungpassautofill",
        )
        return pkgName in overlayPackages
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
