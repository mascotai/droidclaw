package com.thisux.droidclaw.ui.screens

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.thisux.droidclaw.DroidClawApp
import com.thisux.droidclaw.accessibility.DroidClawAccessibilityService
import com.thisux.droidclaw.capture.ScreenCaptureManager
import com.thisux.droidclaw.connection.ConnectionService
import com.thisux.droidclaw.model.ConnectionState
import com.thisux.droidclaw.ui.theme.StatusAmber
import com.thisux.droidclaw.ui.theme.StatusGreen
import com.thisux.droidclaw.ui.theme.StatusRed
import com.thisux.droidclaw.util.BatteryOptimization
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val app = context.applicationContext as DroidClawApp
    val scope = rememberCoroutineScope()

    val connectionState by ConnectionService.connectionState.collectAsState()
    val errorMessage by ConnectionService.errorMessage.collectAsState()

    val serverUrl by app.settingsStore.serverUrl.collectAsState(initial = "")
    val deviceStatus by app.settingsStore.deviceStatus.collectAsState(initial = "")
    val apiKey by app.settingsStore.apiKey.collectAsState(initial = "")

    var editingServerUrl by remember { mutableStateOf<String?>(null) }
    val displayServerUrl = editingServerUrl ?: serverUrl

    val isCaptureAvailable by ScreenCaptureManager.isAvailable.collectAsState()

    var isAccessibilityEnabled by remember {
        mutableStateOf(DroidClawAccessibilityService.isEnabledOnDevice(context))
    }
    var hasCaptureConsent by remember {
        ScreenCaptureManager.restoreConsent(context)
        mutableStateOf(isCaptureAvailable || ScreenCaptureManager.hasConsent())
    }
    var isBatteryExempt by remember {
        mutableStateOf(BatteryOptimization.isIgnoringBatteryOptimizations(context))
    }
    var hasOverlayPermission by remember {
        mutableStateOf(Settings.canDrawOverlays(context))
    }
    var isDefaultAssistant by remember {
        mutableStateOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val rm = context.getSystemService(Context.ROLE_SERVICE) as RoleManager
                rm.isRoleHeld(RoleManager.ROLE_ASSISTANT)
            } else false
        )
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isAccessibilityEnabled = DroidClawAccessibilityService.isEnabledOnDevice(context)
                ScreenCaptureManager.restoreConsent(context)
                hasCaptureConsent = isCaptureAvailable || ScreenCaptureManager.hasConsent()
                isBatteryExempt = BatteryOptimization.isIgnoringBatteryOptimizations(context)
                hasOverlayPermission = Settings.canDrawOverlays(context)
                isDefaultAssistant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val rm = context.getSystemService(Context.ROLE_SERVICE) as RoleManager
                    rm.isRoleHeld(RoleManager.ROLE_ASSISTANT)
                } else false
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val projectionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            ScreenCaptureManager.storeConsent(context, result.resultCode, result.data)
            hasCaptureConsent = true
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Spacer(modifier = Modifier.height(4.dp))

        // --- Server Section ---
        SectionHeader("Server")

        OutlinedTextField(
            value = displayServerUrl,
            onValueChange = { editingServerUrl = it },
            label = { Text("Server URL") },
            placeholder = { Text("https://your-server.example.com") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = RoundedCornerShape(12.dp)
        )

        if (editingServerUrl != null && editingServerUrl != serverUrl) {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        app.settingsStore.setServerUrl(displayServerUrl)
                        // Clear old token when server URL changes — will trigger re-registration
                        app.settingsStore.clearApiKey()
                        app.settingsStore.setDeviceStatus("")
                        editingServerUrl = null
                        // Auto-trigger registration
                        val intent = Intent(context, ConnectionService::class.java).apply {
                            action = ConnectionService.ACTION_DISCONNECT
                        }
                        context.startForegroundService(intent)
                        val connectIntent = Intent(context, ConnectionService::class.java).apply {
                            action = ConnectionService.ACTION_CONNECT
                        }
                        context.startForegroundService(connectIntent)
                    }
                },
                shape = RoundedCornerShape(8.dp)
            ) {
                Text("Save & Register")
            }
        }

        // Registration status indicator
        if (serverUrl.isNotBlank()) {
            RegistrationStatusCard(
                deviceStatus = deviceStatus,
                connectionState = connectionState
            )
        }

        // --- Connection Section ---
        SectionHeader("Connection")

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            )
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(
                                when (connectionState) {
                                    ConnectionState.Connected -> StatusGreen
                                    ConnectionState.PendingApproval -> StatusAmber
                                    ConnectionState.Connecting -> StatusAmber
                                    ConnectionState.Error -> StatusRed
                                    ConnectionState.Disconnected -> Color.Gray
                                }
                            )
                    )
                    Text(
                        text = when (connectionState) {
                            ConnectionState.Connected -> "Connected to server"
                            ConnectionState.PendingApproval -> "Waiting for dashboard approval..."
                            ConnectionState.Connecting -> "Connecting..."
                            ConnectionState.Error -> errorMessage ?: "Connection error"
                            ConnectionState.Disconnected -> "Disconnected"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }

                if (connectionState == ConnectionState.PendingApproval) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                        Text(
                            text = "Polling for approval every 30s...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Button(
                    onClick = {
                        val intent = Intent(context, ConnectionService::class.java).apply {
                            action = if (connectionState == ConnectionState.Disconnected || connectionState == ConnectionState.Error) {
                                ConnectionService.ACTION_CONNECT
                            } else {
                                ConnectionService.ACTION_DISCONNECT
                            }
                        }
                        context.startForegroundService(intent)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    enabled = serverUrl.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (connectionState == ConnectionState.Connected ||
                            connectionState == ConnectionState.Connecting ||
                            connectionState == ConnectionState.PendingApproval) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.primary
                        }
                    )
                ) {
                    Text(
                        when (connectionState) {
                            ConnectionState.Disconnected, ConnectionState.Error -> "Connect"
                            else -> "Disconnect"
                        }
                    )
                }
            }
        }

        // --- Permissions Section ---
        SectionHeader("Permissions")

        ChecklistItem(
            label = "Accessibility service",
            isOk = isAccessibilityEnabled,
            actionLabel = "Enable",
            onAction = { BatteryOptimization.openAccessibilitySettings(context) }
        )

        ChecklistItem(
            label = "Screen capture permission",
            isOk = hasCaptureConsent,
            actionLabel = "Grant",
            onAction = {
                val mgr = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                projectionLauncher.launch(mgr.createScreenCaptureIntent())
            }
        )

        ChecklistItem(
            label = "Battery optimization disabled",
            isOk = isBatteryExempt,
            actionLabel = "Disable",
            onAction = { BatteryOptimization.requestExemption(context) }
        )

        ChecklistItem(
            label = "Overlay permission",
            isOk = hasOverlayPermission,
            actionLabel = "Grant",
            onAction = {
                context.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${context.packageName}")
                    )
                )
            }
        )

        ChecklistItem(
            label = "Default digital assistant",
            isOk = isDefaultAssistant,
            actionLabel = "Set",
            onAction = {
                context.startActivity(
                    Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
                )
            }
        )

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun RegistrationStatusCard(
    deviceStatus: String,
    connectionState: ConnectionState
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = when (deviceStatus) {
                "active" -> MaterialTheme.colorScheme.secondaryContainer
                "rejected" -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
                "pending" -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            when (deviceStatus) {
                "active" -> {
                    Icon(
                        imageVector = Icons.Filled.CheckCircle,
                        contentDescription = "Active",
                        tint = StatusGreen
                    )
                    Text("Device approved", style = MaterialTheme.typography.bodyMedium)
                }
                "rejected" -> {
                    Icon(
                        imageVector = Icons.Filled.Error,
                        contentDescription = "Rejected",
                        tint = MaterialTheme.colorScheme.error
                    )
                    Text("Device rejected", style = MaterialTheme.typography.bodyMedium)
                }
                "pending" -> {
                    Icon(
                        imageVector = Icons.Filled.HourglassTop,
                        contentDescription = "Pending",
                        tint = StatusAmber
                    )
                    Column {
                        Text("Pending approval", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Approve this device from the dashboard",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                else -> {
                    Icon(
                        imageVector = Icons.Filled.Error,
                        contentDescription = "Not registered",
                        tint = Color.Gray
                    )
                    Text("Not registered", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 4.dp)
    )
}

@Composable
private fun ChecklistItem(
    label: String,
    isOk: Boolean,
    actionLabel: String?,
    onAction: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isOk) {
                MaterialTheme.colorScheme.secondaryContainer
            } else {
                MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = if (isOk) Icons.Filled.CheckCircle else Icons.Filled.Error,
                    contentDescription = if (isOk) "OK" else "Missing",
                    tint = if (isOk) StatusGreen else MaterialTheme.colorScheme.error
                )
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
            if (!isOk && actionLabel != null) {
                OutlinedButton(
                    onClick = onAction,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(actionLabel)
                }
            }
        }
    }
}
