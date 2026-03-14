package com.thisux.droidclaw.connection

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.thisux.droidclaw.DroidClawApp
import com.thisux.droidclaw.MainActivity
import com.thisux.droidclaw.R
import com.thisux.droidclaw.capture.ScreenCaptureManager
import com.thisux.droidclaw.model.ConnectionState
import com.thisux.droidclaw.model.GoalMessage
import com.thisux.droidclaw.model.GoalStatus
import com.thisux.droidclaw.model.AgentStep
import com.thisux.droidclaw.model.HeartbeatMessage
import com.thisux.droidclaw.model.AppsMessage
import com.thisux.droidclaw.model.InstalledAppInfo
import com.thisux.droidclaw.util.DeviceInfoHelper
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import com.thisux.droidclaw.model.StopGoalMessage
import com.thisux.droidclaw.overlay.AgentOverlay
import com.thisux.droidclaw.model.VoiceStartMessage
import com.thisux.droidclaw.model.VoiceChunkMessage
import com.thisux.droidclaw.model.VoiceStopMessage
import com.thisux.droidclaw.model.OverlayMode
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class ConnectionService : LifecycleService() {

    companion object {
        private const val TAG = "ConnectionSvc"
        private const val CHANNEL_ID = "droidclaw_connection"
        private const val NOTIFICATION_ID = 1

        val connectionState = MutableStateFlow(ConnectionState.Disconnected)
        val currentSteps = MutableStateFlow<List<AgentStep>>(emptyList())
        val currentGoalStatus = MutableStateFlow(GoalStatus.Idle)
        val currentGoal = MutableStateFlow("")
        val errorMessage = MutableStateFlow<String?>(null)
        val overlayTranscript = MutableStateFlow("")
        var instance: ConnectionService? = null

        const val ACTION_CONNECT = "com.thisux.droidclaw.CONNECT"
        const val ACTION_DISCONNECT = "com.thisux.droidclaw.DISCONNECT"
        const val ACTION_SEND_GOAL = "com.thisux.droidclaw.SEND_GOAL"
        const val ACTION_SHOW_COMMAND_PANEL = "com.thisux.droidclaw.SHOW_COMMAND_PANEL"
        const val EXTRA_GOAL = "goal_text"
    }

    private var webSocket: ReliableWebSocket? = null
    private var commandRouter: CommandRouter? = null
    private var captureManager: ScreenCaptureManager? = null
    private var wakeLock: PowerManager.WakeLock? = null
    internal var overlay: AgentOverlay? = null
    private var registrationPollingJob: kotlinx.coroutines.Job? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        overlay = AgentOverlay(this)
        overlay?.onAudioChunk = { base64 ->
            webSocket?.sendTyped(VoiceChunkMessage(data = base64))
        }
        overlay?.onVoiceSend = { _ ->
            webSocket?.sendTyped(VoiceStopMessage(action = "send"))
        }
        overlay?.onVoiceCancel = {
            webSocket?.sendTyped(VoiceStopMessage(action = "cancel"))
        }
        overlay?.let { ov ->
            lifecycleScope.launch {
                snapshotFlow { ov.mode.value }.collect { mode ->
                    if (mode == OverlayMode.Listening) {
                        webSocket?.sendTyped(VoiceStartMessage())
                    }
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        when (intent?.action) {
            ACTION_CONNECT -> {
                startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
                connect()
            }
            ACTION_DISCONNECT -> {
                disconnect()
                stopSelf()
            }
            ACTION_SEND_GOAL -> {
                val goal = intent.getStringExtra(EXTRA_GOAL) ?: return START_NOT_STICKY
                sendGoal(goal)
            }
            ACTION_SHOW_COMMAND_PANEL -> {
                overlay?.showCommandPanel()
            }
        }

        return START_NOT_STICKY
    }

    private fun connect() {
        lifecycleScope.launch {
            val app = application as DroidClawApp
            val apiKey = app.settingsStore.apiKey.first()
            val serverUrl = app.settingsStore.serverUrl.first()

            if (serverUrl.isBlank()) {
                connectionState.value = ConnectionState.Error
                errorMessage.value = "Server URL not configured"
                stopSelf()
                return@launch
            }

            if (apiKey.isBlank()) {
                // No token — need to register and poll for approval
                startRegistrationFlow(serverUrl)
                return@launch
            }

            // Have a token — connect WebSocket directly
            connectWebSocket(serverUrl, apiKey)
        }
    }

    /**
     * Register with the server and poll for dashboard approval.
     * When approved, stores the token and connects the WebSocket.
     */
    private fun startRegistrationFlow(serverUrl: String) {
        registrationPollingJob?.cancel()
        registrationPollingJob = lifecycleScope.launch {
            val app = application as DroidClawApp
            val fingerprint = app.settingsStore.getOrCreateFingerprint()
            val deviceName = app.settingsStore.deviceName.first()
            val model = android.os.Build.MODEL
            val androidVersion = android.os.Build.VERSION.RELEASE

            // Step 1: Register with the server
            Log.i(TAG, "Registering device with server: $serverUrl")
            val registerResult = DeviceRegistrationApi.register(
                serverUrl, fingerprint, deviceName, model, androidVersion
            )

            registerResult.onFailure { e ->
                Log.e(TAG, "Registration failed: ${e.message}")
                connectionState.value = ConnectionState.Error
                errorMessage.value = "Registration failed: ${e.message}"
                return@launch
            }

            registerResult.onSuccess { response ->
                Log.i(TAG, "Registered, deviceId=${response.deviceId}, status=${response.status}")
                app.settingsStore.setDeviceStatus(response.status)
            }

            // Step 2: Poll for approval
            connectionState.value = ConnectionState.PendingApproval
            errorMessage.value = null
            updateNotification("Waiting for approval...")

            while (true) {
                delay(30_000L)

                val statusResult = DeviceRegistrationApi.pollStatus(serverUrl, fingerprint)
                statusResult.onSuccess { status ->
                    Log.i(TAG, "Poll status: ${status.status}")
                    app.settingsStore.setDeviceStatus(status.status)

                    when (status.status) {
                        "active" -> {
                            val token = status.token
                            if (token != null) {
                                Log.i(TAG, "Device approved! Storing token and connecting.")
                                app.settingsStore.setApiKey(token)
                                connectWebSocket(serverUrl, token)
                                return@launch
                            }
                        }
                        "rejected" -> {
                            connectionState.value = ConnectionState.Error
                            errorMessage.value = "Device registration was rejected"
                            return@launch
                        }
                        // "pending" — keep polling
                    }
                }
                statusResult.onFailure { e ->
                    Log.w(TAG, "Status poll failed: ${e.message}")
                    // Keep polling despite transient failures
                }
            }
        }
    }

    /**
     * Connect WebSocket with an authenticated token.
     * If auth fails, clears the token and falls back to registration.
     */
    private fun connectWebSocket(serverUrl: String, apiKey: String) {
        lifecycleScope.launch {
            ScreenCaptureManager.restoreConsent(this@ConnectionService)
            captureManager = ScreenCaptureManager(this@ConnectionService).also { mgr ->
                if (ScreenCaptureManager.hasConsent()) {
                    try {
                        mgr.initialize(
                            ScreenCaptureManager.consentResultCode!!,
                            ScreenCaptureManager.consentData!!
                        )
                    } catch (e: SecurityException) {
                        Log.w(TAG, "Screen capture unavailable: ${e.message}")
                        ScreenCaptureManager.clearConsent(this@ConnectionService)
                    }
                }
            }

            val ws = ReliableWebSocket(lifecycleScope) { msg ->
                commandRouter?.handleMessage(msg)
            }
            webSocket = ws

            val router = CommandRouter(ws, captureManager)
            router.beforeScreenCapture = { overlay?.hideVignette() }
            router.afterScreenCapture = {
                if (currentGoalStatus.value == GoalStatus.Running &&
                    Settings.canDrawOverlays(this@ConnectionService)) {
                    overlay?.showVignette()
                }
            }
            commandRouter = router

            launch {
                ws.state.collect { state ->
                    connectionState.value = state
                    updateNotification(
                        when (state) {
                            ConnectionState.Connected -> "Connected to server"
                            ConnectionState.PendingApproval -> "Waiting for approval..."
                            ConnectionState.Connecting -> "Connecting..."
                            ConnectionState.Error -> "Connection error"
                            ConnectionState.Disconnected -> "Disconnected"
                        }
                    )
                    // Send installed apps list once connected
                    if (state == ConnectionState.Connected) {
                        val app = application as DroidClawApp
                        app.settingsStore.setDeviceStatus("active")

                        if (Settings.canDrawOverlays(this@ConnectionService)) {
                            overlay?.show()
                        }
                        val apps = getInstalledApps()
                        webSocket?.sendTyped(AppsMessage(apps = apps))
                        Log.i(TAG, "Sent ${apps.size} installed apps to server")
                    }
                    // If auth failed, clear token and restart with registration
                    if (state == ConnectionState.Error) {
                        val errMsg = ws.errorMessage.value ?: ""
                        if (errMsg.contains("auth", ignoreCase = true) ||
                            errMsg.contains("unauthorized", ignoreCase = true) ||
                            errMsg.contains("invalid", ignoreCase = true)) {
                            Log.w(TAG, "Auth failed, clearing token and re-registering")
                            val app = application as DroidClawApp
                            app.settingsStore.clearApiKey()
                            app.settingsStore.setDeviceStatus("")
                            ws.disconnect()
                            webSocket = null
                            commandRouter?.reset()
                            commandRouter = null
                            startRegistrationFlow(serverUrl)
                        }
                    }
                }
            }
            launch { ws.errorMessage.collect { errorMessage.value = it } }
            launch { router.currentSteps.collect { currentSteps.value = it } }
            launch {
                router.currentGoalStatus.collect { status ->
                    currentGoalStatus.value = status
                    if (status == GoalStatus.Running) {
                        if (Settings.canDrawOverlays(this@ConnectionService)) {
                            overlay?.showVignette()
                        }
                    } else {
                        overlay?.hideVignette()
                    }
                    if (status == GoalStatus.Completed) {
                        val goal = router.currentGoal.value
                        if (goal.isNotBlank()) {
                            (application as DroidClawApp).settingsStore.addRecentGoal(goal)
                        }
                    }
                    // Auto-reset to idle after showing completed/failed for 3s
                    if (status == GoalStatus.Completed || status == GoalStatus.Failed) {
                        launch {
                            delay(3000)
                            // Only reset if status hasn't changed (e.g. new goal started)
                            if (currentGoalStatus.value == status) {
                                currentGoalStatus.value = GoalStatus.Idle
                            }
                        }
                    }
                }
            }
            launch { router.currentGoal.collect { currentGoal.value = it } }

            acquireWakeLock()

            val deviceInfo = DeviceInfoHelper.get(this@ConnectionService)
            ws.connect(serverUrl, apiKey, deviceInfo)

            // Periodic heartbeat for battery updates
            launch {
                while (true) {
                    delay(60_000L) // every 60 seconds
                    if (connectionState.value == ConnectionState.Connected) {
                        val (battery, charging) = DeviceInfoHelper.getBattery(this@ConnectionService)
                        webSocket?.sendTyped(HeartbeatMessage(
                            batteryLevel = battery,
                            isCharging = charging
                        ))
                    }
                }
            }
        }
    }

    private fun sendGoal(text: String) {
        webSocket?.sendTyped(GoalMessage(text = text))
    }

    fun stopGoal() {
        webSocket?.sendTyped(StopGoalMessage())
    }

    private fun disconnect() {
        registrationPollingJob?.cancel()
        registrationPollingJob = null
        overlay?.hideVignette()
        overlay?.hide()
        webSocket?.disconnect()
        webSocket = null
        commandRouter?.reset()
        commandRouter = null
        captureManager?.release()
        captureManager = null
        releaseWakeLock()
        connectionState.value = ConnectionState.Disconnected
    }

    override fun onDestroy() {
        overlay?.destroy()
        overlay = null
        disconnect()
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    private fun getInstalledApps(): List<InstalledAppInfo> {
        val pm = packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = pm.queryIntentActivities(intent, PackageManager.MATCH_ALL)
        val apps = activities.mapNotNull { resolveInfo ->
            val pkg = resolveInfo.activityInfo.packageName
            val label = resolveInfo.loadLabel(pm).toString()
            InstalledAppInfo(packageName = pkg, label = label)
        }.distinctBy { it.packageName }.sortedBy { it.label.lowercase() }

        // Discover intent capabilities per app
        val intentMap = discoverIntentCapabilities()
        return apps.map { app ->
            val intents = intentMap[app.packageName]
            if (intents != null) app.copy(intents = intents.toList()) else app
        }
    }

    /**
     * Probe installed apps to discover which URI schemes and intent actions
     * each app supports. Returns a map of packageName -> list of capabilities.
     * Format: "VIEW:scheme", "SENDTO:scheme", "SEND:mime", or action name.
     */
    private fun discoverIntentCapabilities(): Map<String, List<String>> {
        val pm = packageManager
        val result = mutableMapOf<String, MutableSet<String>>()

        // Probe ACTION_VIEW with common URI schemes
        val viewSchemes = listOf(
            "tel", "sms", "smsto", "mailto", "geo", "https", "http",
            "whatsapp", "instagram", "twitter", "fb", "spotify",
            "vnd.youtube", "zoomus", "upi", "phonepe", "paytm",
            "gpay", "tez", "google.navigation", "uber", "skype",
            "viber", "telegram", "snapchat", "linkedin", "reddit",
            "swiggy", "zomato", "ola", "maps.google.com"
        )
        for (scheme in viewSchemes) {
            try {
                val probe = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://test"))
                val resolvers = pm.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY)
                for (info in resolvers) {
                    result.getOrPut(info.activityInfo.packageName) { mutableSetOf() }
                        .add("VIEW:$scheme")
                }
            } catch (_: Exception) { /* skip invalid scheme */ }
        }

        // Probe ACTION_SENDTO (sms, mailto)
        for (scheme in listOf("sms", "mailto")) {
            try {
                val probe = Intent(Intent.ACTION_SENDTO, Uri.parse("$scheme:test"))
                val resolvers = pm.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY)
                for (info in resolvers) {
                    result.getOrPut(info.activityInfo.packageName) { mutableSetOf() }
                        .add("SENDTO:$scheme")
                }
            } catch (_: Exception) {}
        }

        // Probe ACTION_SEND (share) with common MIME types
        for (mime in listOf("text/plain", "image/*")) {
            try {
                val probe = Intent(Intent.ACTION_SEND).apply { type = mime }
                val resolvers = pm.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY)
                for (info in resolvers) {
                    result.getOrPut(info.activityInfo.packageName) { mutableSetOf() }
                        .add("SEND:$mime")
                }
            } catch (_: Exception) {}
        }

        // Probe special actions
        val specialActions = listOf(
            "android.intent.action.SET_ALARM",
            "android.intent.action.SET_TIMER",
            "android.intent.action.DIAL",
            "android.intent.action.INSERT",
            "android.intent.action.CALL"
        )
        for (action in specialActions) {
            try {
                val probe = Intent(action)
                val resolvers = pm.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY)
                for (info in resolvers) {
                    result.getOrPut(info.activityInfo.packageName) { mutableSetOf() }
                        .add(action)
                }
            } catch (_: Exception) {}
        }

        return result.mapValues { it.value.toList() }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "DroidClaw Connection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when DroidClaw is connected to the server"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val disconnectIntent = PendingIntent.getService(
            this, 1,
            Intent(this, ConnectionService::class.java).apply {
                action = ACTION_DISCONNECT
            },
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("DroidClaw")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .addAction(0, "Disconnect", disconnectIntent)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "DroidClaw::ConnectionWakeLock"
        ).apply {
            acquire(10 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }
}
