package com.thisux.droidclaw

import android.content.Context
import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.thisux.droidclaw.accessibility.GestureExecutor
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * Instrumented tests for the OkHttp-based download approach used by
 * [GestureExecutor.executeDownload].
 *
 * These tests validate that direct OkHttp downloads work correctly,
 * bypassing Android's DownloadManager (which is throttled by the MDM
 * on Esper-managed devices).
 */
@RunWith(AndroidJUnit4::class)
class DownloadManagerTest {

    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    // Small test file (~788 KB)
    private val testUrl = "https://www.w3schools.com/html/mov_bbb.mp4"

    // Track files to clean up
    private val testFiles = mutableListOf<File>()

    @After
    fun cleanup() {
        testFiles.forEach { file ->
            try {
                if (file.exists()) file.delete()
            } catch (_: Exception) {
            }
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /**
     * Downloads [url] to [destFile] using OkHttp, returning true on success.
     */
    private fun downloadFile(url: String, destFile: File): Boolean {
        destFile.parentFile?.mkdirs()
        if (destFile.exists()) destFile.delete()

        val request = Request.Builder().url(url).build()
        val response = httpClient.newCall(request).execute()

        if (!response.isSuccessful) {
            response.close()
            return false
        }

        val body = response.body ?: run {
            response.close()
            return false
        }

        body.byteStream().use { input ->
            FileOutputStream(destFile).use { output ->
                input.copyTo(output)
            }
        }
        response.close()
        return true
    }

    // ---------------------------------------------------------------
    // Tests
    // ---------------------------------------------------------------

    @Test
    fun downloadSmallFileSucceeds() {
        val filename = "test_download_${System.currentTimeMillis()}.mp4"
        val resolved = GestureExecutor.resolveDownloadPath(filename)

        val destFile = File(
            context.getExternalFilesDir(resolved.directory) ?: context.cacheDir,
            resolved.subPath
        )
        testFiles.add(destFile)

        val success = downloadFile(testUrl, destFile)

        assertTrue("Download should succeed", success)
        assertTrue("Downloaded file should exist", destFile.exists())
        assertTrue("Downloaded file should have bytes > 0", destFile.length() > 0)
    }

    @Test
    fun downloadToAlbumCreatesDirectory() {
        val albumName = "TestAlbum_${System.currentTimeMillis()}"
        val rawPath = "$albumName/test.mp4"
        val resolved = GestureExecutor.resolveDownloadPath(rawPath)

        // resolveDownloadPath should route album paths to Pictures
        assertEquals(Environment.DIRECTORY_PICTURES, resolved.directory)
        assertEquals(rawPath, resolved.subPath)
        assertEquals("test.mp4", resolved.filename)

        val destFile = File(
            context.getExternalFilesDir(resolved.directory) ?: context.cacheDir,
            resolved.subPath
        )
        testFiles.add(destFile)
        // Also track album directory for cleanup
        destFile.parentFile?.let { testFiles.add(it) }

        val success = downloadFile(testUrl, destFile)

        assertTrue("Download to album should succeed", success)
        assertTrue("Downloaded file should exist", destFile.exists())
        assertTrue("Album directory should exist", destFile.parentFile?.exists() == true)
        assertTrue("Downloaded file should have bytes > 0", destFile.length() > 0)
    }

    @Test
    fun downloadInvalidUrlFails() {
        val filename = "nonexistent_${System.currentTimeMillis()}.mp4"
        val resolved = GestureExecutor.resolveDownloadPath(filename)

        val destFile = File(
            context.getExternalFilesDir(resolved.directory) ?: context.cacheDir,
            resolved.subPath
        )
        testFiles.add(destFile)

        // example.com/nonexistent.mp4 should return a non-200 status (likely 404)
        val request = Request.Builder()
            .url("https://example.com/nonexistent.mp4")
            .build()
        val response = httpClient.newCall(request).execute()
        val httpCode = response.code
        response.close()

        // The HTTP status should indicate failure (4xx or 5xx)
        assertTrue(
            "Download of invalid URL should return non-success HTTP code, got $httpCode",
            httpCode in 400..599
        )
    }
}
