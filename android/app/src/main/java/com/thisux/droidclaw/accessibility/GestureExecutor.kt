package com.thisux.droidclaw.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.DownloadManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Path
import android.media.MediaScannerConnection
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.ContactsContract
import android.provider.CalendarContract
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.thisux.droidclaw.model.ServerMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request as OkRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

data class ActionResult(val success: Boolean, val error: String? = null, val data: String? = null)

class GestureExecutor(private val service: DroidClawAccessibilityService) {

    private val httpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build()
    }

    companion object {
        private const val TAG = "GestureExecutor"

        data class DownloadPath(val directory: String, val subPath: String, val filename: String)

        fun resolveDownloadPath(rawPath: String): DownloadPath {
            val hasAlbum = rawPath.contains("/")
            return if (hasAlbum) {
                DownloadPath(Environment.DIRECTORY_PICTURES, rawPath, rawPath.substringAfterLast("/"))
            } else {
                DownloadPath(Environment.DIRECTORY_DOWNLOADS, rawPath, rawPath)
            }
        }
    }

    suspend fun execute(msg: ServerMessage): ActionResult {
        return try {
            when (msg.type) {
                "tap" -> executeTap(msg.x ?: 0, msg.y ?: 0)
                "type" -> executeType(msg.text ?: "")
                "enter" -> executeEnter()
                "back" -> executeGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                "home" -> executeGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                "notifications" -> executeGlobalAction(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS)
                "recents" -> executeGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
                "split_screen" -> executeGlobalAction(AccessibilityService.GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN)
                "longpress" -> executeLongPress(msg.x ?: 0, msg.y ?: 0)
                "swipe" -> executeSwipe(
                    msg.x1 ?: 0, msg.y1 ?: 0,
                    msg.x2 ?: 0, msg.y2 ?: 0,
                    msg.duration ?: 300
                )
                "launch" -> executeLaunch(msg)
                "clear" -> executeClear()
                "clipboard_set" -> executeClipboardSet(msg.text ?: "")
                "clipboard_get" -> executeClipboardGet()
                "paste" -> executePaste()
                "open_url" -> executeOpenUrl(msg.url ?: "")
                "switch_app" -> executeLaunch(msg)
                "keyevent" -> executeKeyEvent(msg.code ?: 0)
                "open_settings" -> executeOpenSettings(msg.setting)
                "wait" -> executeWait(msg.duration ?: 1000)
                "intent" -> executeIntent(msg)
                "screenshot" -> executeScreenshot()
                "download" -> executeDownload(msg)
                "diagnose" -> executeDiagnose()
                "shell" -> executeShell(msg.text ?: "")
                else -> ActionResult(false, "Unknown action: ${msg.type}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Action ${msg.type} failed", e)
            ActionResult(false, e.message)
        }
    }

    private suspend fun executeTap(x: Int, y: Int): ActionResult {
        // Always use raw gesture dispatch for taps. This sends a real touch event
        // at the exact screen coordinates, which correctly hits whatever is visually
        // on top. ACTION_CLICK on accessibility nodes can trigger background elements
        // when overlapping views exist (e.g., bottom sheets over scrollable lists).
        return dispatchTapGesture(x, y)
    }

    private suspend fun executeType(text: String): ActionResult {
        val focused = findFocusedNode()
        if (focused != null) {
            try {
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                }
                if (focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                    return ActionResult(true)
                }
            } finally {
                focused.recycle()
            }
        }
        return ActionResult(false, "No focused editable node found")
    }

    private fun executeEnter(): ActionResult {
        val focused = findFocusedNode()
        if (focused != null) {
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                    val action = AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER
                    if (focused.performAction(action.id)) {
                        return ActionResult(true)
                    }
                }
            } finally {
                focused.recycle()
            }
        }
        // Fallback: dispatch Enter keyevent
        return executeKeyEvent(android.view.KeyEvent.KEYCODE_ENTER)
    }

    private fun executeGlobalAction(action: Int): ActionResult {
        val success = service.performGlobalAction(action)
        return ActionResult(success, if (!success) "Global action failed" else null)
    }

    private suspend fun executeLongPress(x: Int, y: Int): ActionResult {
        val node = service.findNodeAt(x, y)
        if (node != null) {
            try {
                if (node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) {
                    return ActionResult(true)
                }
            } finally {
                node.recycle()
            }
        }
        return dispatchSwipeGesture(x, y, x, y, 1000)
    }

    private suspend fun executeSwipe(x1: Int, y1: Int, x2: Int, y2: Int, duration: Int): ActionResult {
        return dispatchSwipeGesture(x1, y1, x2, y2, duration)
    }

    private fun executeLaunch(msg: ServerMessage): ActionResult {
        val packageName = msg.packageName ?: ""
        val uri = msg.intentUri
        val extras = msg.intentExtras

        // If URI is provided, use ACTION_VIEW intent (deep link / intent with data)
        if (!uri.isNullOrEmpty()) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (packageName.isNotEmpty()) setPackage(packageName)
                extras?.forEach { (k, v) -> putExtra(k, v) }
            }
            return try {
                service.startActivity(intent)
                ActionResult(true)
            } catch (e: Exception) {
                ActionResult(false, "Intent failed: ${e.message}")
            }
        }

        // Standard package launch
        if (packageName.isEmpty()) return ActionResult(false, "No package or URI provided")
        val intent = service.packageManager.getLaunchIntentForPackage(packageName)
            ?: return ActionResult(false, "Package not found: $packageName")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        extras?.forEach { (k, v) -> intent.putExtra(k, v) }
        service.startActivity(intent)
        return ActionResult(true)
    }

    private fun executeClear(): ActionResult {
        val focused = findFocusedNode()
        if (focused != null) {
            try {
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
                }
                if (focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                    return ActionResult(true)
                }
            } finally {
                focused.recycle()
            }
        }
        return ActionResult(false, "No focused editable node to clear")
    }

    private fun executeClipboardSet(text: String): ActionResult {
        val clipboard = service.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = android.content.ClipData.newPlainText("droidclaw", text)
        clipboard.setPrimaryClip(clip)
        return ActionResult(true)
    }

    private fun executeClipboardGet(): ActionResult {
        val clipboard = service.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val text = clipboard.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
        return ActionResult(true, data = text)
    }

    private fun executePaste(): ActionResult {
        val focused = findFocusedNode()
        if (focused != null) {
            try {
                if (focused.performAction(AccessibilityNodeInfo.ACTION_PASTE)) {
                    return ActionResult(true)
                }
            } finally {
                focused.recycle()
            }
        }
        return ActionResult(false, "No focused node to paste into")
    }

    private fun executeOpenUrl(url: String): ActionResult {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        service.startActivity(intent)
        return ActionResult(true)
    }

    private fun executeKeyEvent(code: Int): ActionResult {
        return try {
            Runtime.getRuntime().exec(arrayOf("input", "keyevent", code.toString()))
            ActionResult(true)
        } catch (e: Exception) {
            ActionResult(false, "keyevent failed: ${e.message}")
        }
    }

    private fun executeIntent(msg: ServerMessage): ActionResult {
        val intentAction = msg.intentAction
            ?: return ActionResult(false, "No intentAction provided")

        val extras = msg.intentExtras
        var parsedUri = msg.intentUri?.let { Uri.parse(it) }

        // For mailto: URIs, encode subject and body into the URI query params
        // because many email apps ignore intent extras with SENDTO+mailto
        if (parsedUri?.scheme == "mailto" && !extras.isNullOrEmpty()) {
            val subject = extras["android.intent.extra.SUBJECT"]
            val body = extras["android.intent.extra.TEXT"]
            val baseEmail = parsedUri.schemeSpecificPart.split("?")[0]
            val params = mutableListOf<String>()
            if (!subject.isNullOrEmpty()) params.add("subject=${Uri.encode(subject)}")
            if (!body.isNullOrEmpty()) params.add("body=${Uri.encode(body)}")
            if (params.isNotEmpty()) {
                parsedUri = Uri.parse("mailto:$baseEmail?${params.joinToString("&")}")
            }
        }

        val intent = Intent(intentAction).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

            val mimeType = msg.intentType

            when {
                parsedUri != null && mimeType != null -> setDataAndType(parsedUri, mimeType)
                parsedUri != null -> data = parsedUri
                mimeType != null -> type = mimeType
            }

            msg.packageName?.let { setPackage(it) }

            // Auto-detect numeric extras (needed for SET_ALARM HOUR/MINUTES etc.)
            extras?.forEach { (k, v) ->
                val intVal = v.toIntOrNull()
                val longVal = v.toLongOrNull()
                when {
                    intVal != null -> putExtra(k, intVal)
                    longVal != null -> putExtra(k, longVal)
                    else -> putExtra(k, v)
                }
            }
        }

        return try {
            service.startActivity(intent)
            ActionResult(true)
        } catch (e: Exception) {
            ActionResult(false, "Intent failed: ${e.message}")
        }
    }

    private fun executeOpenSettings(setting: String?): ActionResult {
        val action = when (setting) {
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "battery" -> Intent.ACTION_POWER_USAGE_SUMMARY
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "date" -> Settings.ACTION_DATE_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "developer" -> Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
            "dnd" -> "android.settings.ZEN_MODE_SETTINGS"
            "network" -> Settings.ACTION_WIRELESS_SETTINGS
            "storage" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
            "security" -> Settings.ACTION_SECURITY_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        val intent = Intent(action).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            service.startActivity(intent)
            ActionResult(true)
        } catch (e: Exception) {
            ActionResult(false, "Settings intent failed: ${e.message}")
        }
    }

    private fun executeScreenshot(): ActionResult {
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            val success = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_TAKE_SCREENSHOT)
            if (success) ActionResult(true, data = "Screenshot saved to gallery")
            else ActionResult(false, "Screenshot global action failed")
        } else {
            ActionResult(false, "Screenshot requires Android 9+")
        }
    }

    private suspend fun executeDownload(msg: ServerMessage): ActionResult {
        val url = msg.url ?: return ActionResult(false, "No URL provided")
        val rawPath = msg.text ?: Uri.parse(url).lastPathSegment
            ?: "download_${System.currentTimeMillis()}.mp4"

        // Support album/filename format: "MyAlbum/video.mp4" downloads to Pictures/MyAlbum/video.mp4
        // Plain filename like "video.mp4" downloads to Downloads/video.mp4
        val resolved = resolveDownloadPath(rawPath)
        val directory = resolved.directory
        val subPath = resolved.subPath
        val hasAlbum = rawPath.contains("/")

        return try {
            // Check if we need to use app-specific storage (no external storage permission on older APIs)
            val useAppStorage = service.checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE") != PackageManager.PERMISSION_GRANTED
                && android.os.Build.VERSION.SDK_INT < 29

            // Ensure album directory exists if needed
            if (hasAlbum) {
                val albumDir = if (useAppStorage) {
                    val appDir = service.getExternalFilesDir(directory) ?: service.cacheDir
                    java.io.File(appDir, rawPath.substringBeforeLast("/"))
                } else {
                    Environment.getExternalStoragePublicDirectory(directory)
                        .resolve(rawPath.substringBeforeLast("/"))
                }
                Log.d(TAG, "Album dir: $albumDir exists=${albumDir.exists()}")
                if (!albumDir.exists()) {
                    val created = albumDir.mkdirs()
                    Log.d(TAG, "Album dir created=$created")
                }
            }

            // Delete existing file at destination to avoid duplicates
            val destFile = if (useAppStorage) {
                val appDir = service.getExternalFilesDir(directory) ?: service.cacheDir
                java.io.File(appDir, subPath)
            } else {
                Environment.getExternalStoragePublicDirectory(directory).resolve(subPath)
            }
            if (destFile.exists()) {
                val deleted = destFile.delete()
                Log.d(TAG, "Deleted existing file at $destFile: $deleted")
            }
            destFile.parentFile?.mkdirs()

            // Download via OkHttp (bypasses DownloadManager MDM throttling)
            Log.d(TAG, "Starting OkHttp download: url=$url dest=$destFile")
            val request = OkRequest.Builder().url(url).build()
            val response = withContext(Dispatchers.IO) {
                httpClient.newCall(request).execute()
            }

            if (!response.isSuccessful) {
                val code = response.code
                response.close()
                Log.e(TAG, "Download HTTP error: $code")
                return ActionResult(false, "Download failed: HTTP $code")
            }

            val body = response.body
            if (body == null) {
                response.close()
                return ActionResult(false, "Download failed: empty response body")
            }

            // Stream to file
            val totalBytes = body.contentLength()
            var bytesWritten = 0L
            withContext(Dispatchers.IO) {
                body.byteStream().use { input ->
                    FileOutputStream(destFile).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            bytesWritten += bytesRead
                            if (bytesWritten % (1024 * 1024) < 8192) {
                                Log.d(TAG, "Download progress: $bytesWritten / $totalBytes bytes")
                            }
                        }
                    }
                }
            }
            response.close()

            val filePath = destFile.absolutePath
            Log.d(TAG, "Download complete: $filePath ($bytesWritten bytes)")

            // Notify media scanner so file appears in Gallery
            MediaScannerConnection.scanFile(
                service, arrayOf(filePath), null, null
            )

            ActionResult(true, data = filePath)
        } catch (e: java.net.SocketTimeoutException) {
            Log.e(TAG, "Download timed out", e)
            ActionResult(false, "Download timed out: ${e.message}")
        } catch (e: java.io.IOException) {
            Log.e(TAG, "Download I/O error", e)
            ActionResult(false, "Download I/O error: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Download failed", e)
            ActionResult(false, "Download exception: ${e.message}")
        }
    }

    /**
     * Collects device diagnostics + runs a live download test.
     * Returns everything as a JSON report in ActionResult.data.
     */
    private suspend fun executeDiagnose(): ActionResult {
        val report = JSONObject()
        report.put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", java.util.Locale.US).format(java.util.Date()))

        // ── 1. Live download test ──────────────────────────────────────
        val downloadTest = JSONObject()
        val testUrl = "https://www.google.com/favicon.ico"
        downloadTest.put("url", testUrl)
        try {
            val startMs = System.currentTimeMillis()

            val destFile = java.io.File(
                service.getExternalFilesDir(null) ?: service.cacheDir,
                "droidclaw_diagnose_test.ico"
            )
            if (destFile.exists()) destFile.delete()

            val request = OkRequest.Builder().url(testUrl).build()
            val response = withContext(Dispatchers.IO) {
                httpClient.newCall(request).execute()
            }

            var testSuccess = false
            var testError: String? = null

            if (!response.isSuccessful) {
                testError = "HTTP ${response.code}"
                response.close()
            } else {
                val body = response.body
                if (body == null) {
                    testError = "Empty response body"
                    response.close()
                } else {
                    withContext(Dispatchers.IO) {
                        body.byteStream().use { input ->
                            FileOutputStream(destFile).use { output ->
                                input.copyTo(output)
                            }
                        }
                    }
                    response.close()
                    testSuccess = destFile.exists() && destFile.length() > 0
                    if (!testSuccess) testError = "File empty or missing after download"
                }
            }

            downloadTest.put("success", testSuccess)
            if (testError != null) downloadTest.put("error", testError)
            downloadTest.put("durationMs", System.currentTimeMillis() - startMs)

            // Clean up test file
            if (destFile.exists()) destFile.delete()
        } catch (e: Exception) {
            downloadTest.put("success", false)
            downloadTest.put("error", "Exception: ${e.message}")
        }
        report.put("downloadTest", downloadTest)

        // ── 2. DownloadManager queue ───────────────────────────────────
        val downloads = JSONObject()
        try {
            val dm = service.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
            if (dm != null) {
                val cursor = dm.query(DownloadManager.Query())
                var pending = 0; var running = 0; var paused = 0; var failed = 0; var successful = 0
                val stuck = JSONArray()
                if (cursor != null) {
                    val idIdx = cursor.getColumnIndex(DownloadManager.COLUMN_ID)
                    val titleIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TITLE)
                    val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                    val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                    val bytesIdx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                    while (cursor.moveToNext()) {
                        val status = cursor.getInt(statusIdx)
                        when (status) {
                            DownloadManager.STATUS_PENDING -> pending++
                            DownloadManager.STATUS_RUNNING -> running++
                            DownloadManager.STATUS_PAUSED -> paused++
                            DownloadManager.STATUS_FAILED -> failed++
                            DownloadManager.STATUS_SUCCESSFUL -> successful++
                        }
                        if (status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                            val entry = JSONObject()
                            entry.put("id", cursor.getLong(idIdx))
                            entry.put("title", if (titleIdx >= 0) cursor.getString(titleIdx) else "")
                            entry.put("status", when (status) {
                                DownloadManager.STATUS_PENDING -> "PENDING"
                                else -> "PAUSED"
                            })
                            entry.put("reason", if (reasonIdx >= 0) cursor.getInt(reasonIdx) else 0)
                            entry.put("bytes", if (bytesIdx >= 0) cursor.getLong(bytesIdx) else 0)
                            stuck.put(entry)
                        }
                    }
                    cursor.close()
                }
                downloads.put("pending", pending)
                downloads.put("running", running)
                downloads.put("paused", paused)
                downloads.put("failed", failed)
                downloads.put("successful", successful)
                downloads.put("stuck", stuck)
            }
        } catch (e: Exception) {
            downloads.put("error", e.message)
        }
        report.put("downloads", downloads)

        // ── 3. Network state ───────────────────────────────────────────
        val network = JSONObject()
        try {
            val cm = service.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val activeNetwork = cm.activeNetwork
            val caps = if (activeNetwork != null) cm.getNetworkCapabilities(activeNetwork) else null
            network.put("connected", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
            network.put("type", when {
                caps == null -> "NONE"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
                else -> "OTHER"
            })
            network.put("vpn", caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)

            // Proxy
            val proxy = java.net.ProxySelector.getDefault()?.select(java.net.URI("https://www.google.com"))
            val proxyStr = if (proxy != null && proxy.isNotEmpty() && proxy[0].type() != java.net.Proxy.Type.DIRECT) {
                proxy[0].address()?.toString() ?: "CONFIGURED"
            } else "NONE"
            network.put("proxy", proxyStr)

            // DNS reachability — getByName resolves via DNS; isReachable uses ICMP
            // which is blocked on most Android devices, so we only rely on resolution
            val dnsReachable = try {
                InetAddress.getByName("dns.google")
                true // DNS resolution succeeded
            } catch (_: Exception) { false }
            network.put("dnsReachable", dnsReachable)
        } catch (e: Exception) {
            network.put("error", e.message)
        }
        report.put("network", network)

        // ── 4. Storage ─────────────────────────────────────────────────
        val storage = JSONObject()
        try {
            val internalStat = StatFs(Environment.getDataDirectory().path)
            storage.put("internalFreeBytes", internalStat.availableBytes)
            val externalDir = Environment.getExternalStorageDirectory()
            if (externalDir.exists()) {
                val externalStat = StatFs(externalDir.path)
                storage.put("externalFreeBytes", externalStat.availableBytes)
            }
        } catch (e: Exception) {
            storage.put("error", e.message)
        }
        report.put("storage", storage)

        // ── 5. Battery ─────────────────────────────────────────────────
        val battery = JSONObject()
        try {
            val bm = service.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            battery.put("level", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            battery.put("charging", bm.isCharging)

            val pm = service.getSystemService(Context.POWER_SERVICE) as PowerManager
            battery.put("optimized", !pm.isIgnoringBatteryOptimizations(service.packageName))
        } catch (e: Exception) {
            battery.put("error", e.message)
        }
        report.put("battery", battery)

        // ── 6. Permissions ─────────────────────────────────────────────
        val permissions = JSONObject()
        try {
            val permsToCheck = listOf(
                "android.permission.INTERNET",
                "android.permission.WRITE_EXTERNAL_STORAGE",
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.ACCESS_NETWORK_STATE",
                "android.permission.ACCESS_WIFI_STATE",
                "android.permission.DOWNLOAD_WITHOUT_NOTIFICATION"
            )
            for (perm in permsToCheck) {
                val shortName = perm.substringAfterLast(".")
                permissions.put(shortName, service.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED)
            }
        } catch (e: Exception) {
            permissions.put("error", e.message)
        }
        report.put("permissions", permissions)

        // ── 7. Device management / MDM ─────────────────────────────────
        val deviceManagement = JSONObject()
        try {
            val dpm = service.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

            // Device owner
            val ownerInfo = if (dpm.isDeviceOwnerApp(service.packageName)) {
                service.packageName
            } else {
                // Try to find who is the device owner
                try {
                    // getDeviceOwner() was hidden but accessible via reflection, fall back to listing admins
                    val activeAdmins = dpm.activeAdmins
                    val ownerPkgs = activeAdmins?.map { it.packageName }?.distinct() ?: emptyList()
                    // Heuristic: check known MDM packages
                    ownerPkgs.firstOrNull { it.contains("esper") || it.contains("mdm") || it.contains("airwatch") || it.contains("mobileiron") }
                        ?: ownerPkgs.firstOrNull()
                        ?: "none"
                } catch (_: Exception) { "unknown" }
            }
            deviceManagement.put("deviceOwner", ownerInfo)

            val admins = dpm.activeAdmins?.map { it.packageName }?.distinct() ?: emptyList()
            deviceManagement.put("deviceAdmins", JSONArray(admins))

            // Work profile: check if managed profile exists
            deviceManagement.put("workProfile", dpm.activeAdmins?.any {
                dpm.isProfileOwnerApp(it.packageName)
            } == true)
        } catch (e: Exception) {
            deviceManagement.put("error", e.message)
        }
        report.put("deviceManagement", deviceManagement)

        // ── 8. Logcat (last 200 lines for DroidClaw + DownloadManager) ─
        var logcat = ""
        try {
            val process = Runtime.getRuntime().exec(arrayOf(
                "logcat", "-d", "-t", "200",
                "-s", "GestureExecutor:*", "DroidClaw:*", "CommandRouter:*",
                "DownloadManager:*", "DownloadProvider:*"
            ))
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            logcat = reader.readText()
            reader.close()
            process.waitFor()
        } catch (e: Exception) {
            logcat = "Failed to read logcat: ${e.message}"
        }
        report.put("logcat", logcat)

        return ActionResult(true, data = report.toString())
    }

    /**
     * Execute an arbitrary shell command on the device and return stdout+stderr.
     * Useful for debugging and device introspection (e.g. pm list users, getprop, etc.)
     */
    private suspend fun executeShell(command: String): ActionResult {
        if (command.isBlank()) return ActionResult(false, "Empty command")
        return try {
            val process = withContext(Dispatchers.IO) {
                Runtime.getRuntime().exec(arrayOf("sh", "-c", command))
            }
            val stdout = withContext(Dispatchers.IO) {
                BufferedReader(InputStreamReader(process.inputStream)).readText()
            }
            val stderr = withContext(Dispatchers.IO) {
                BufferedReader(InputStreamReader(process.errorStream)).readText()
            }
            val exitCode = withContext(Dispatchers.IO) { process.waitFor() }
            val output = buildString {
                if (stdout.isNotEmpty()) append(stdout)
                if (stderr.isNotEmpty()) {
                    if (isNotEmpty()) append("\n--- stderr ---\n")
                    append(stderr)
                }
            }
            ActionResult(exitCode == 0, if (exitCode != 0) "exit code $exitCode" else null, data = output)
        } catch (e: Exception) {
            ActionResult(false, "Shell exec failed: ${e.message}")
        }
    }

    private suspend fun executeWait(duration: Int): ActionResult {
        kotlinx.coroutines.delay(duration.toLong())
        return ActionResult(true)
    }

    private suspend fun dispatchTapGesture(x: Int, y: Int): ActionResult {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture)
    }

    private suspend fun dispatchSwipeGesture(
        x1: Int, y1: Int, x2: Int, y2: Int, duration: Int
    ): ActionResult {
        val path = Path().apply {
            moveTo(x1.toFloat(), y1.toFloat())
            lineTo(x2.toFloat(), y2.toFloat())
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration.toLong())
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture)
    }

    private suspend fun dispatchGesture(gesture: GestureDescription): ActionResult =
        suspendCancellableCoroutine { cont ->
            service.dispatchGesture(
                gesture,
                object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        if (cont.isActive) cont.resume(ActionResult(true))
                    }
                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        if (cont.isActive) cont.resume(ActionResult(false, "Gesture cancelled"))
                    }
                },
                null
            )
        }

    private fun findFocusedNode(): AccessibilityNodeInfo? {
        return service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    }
}
