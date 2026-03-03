package com.thisux.droidclaw

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Automatically restarts DroidClaw after:
 *  - Device boot (BOOT_COMPLETED)
 *  - APK update (MY_PACKAGE_REPLACED)
 *
 * Launches MainActivity which handles starting the ConnectionService.
 */
class AutoStartReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "AutoStartReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "Received: ${intent.action}")

        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Log.i(TAG, "Launching MainActivity after ${intent.action}")
                val launch = Intent(context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(launch)
            }
        }
    }
}
