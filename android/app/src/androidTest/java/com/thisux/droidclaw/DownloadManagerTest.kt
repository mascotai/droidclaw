package com.thisux.droidclaw

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.thisux.droidclaw.accessibility.GestureExecutor
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented tests for DownloadManager behaviour on a real Android system.
 *
 * These tests use the same DownloadManager enqueue-and-poll approach as
 * [GestureExecutor.executeDownload] to validate the exact download path
 * that runs in production on the Esper-managed device.
 *
 * Note: On API 30+ (scoped storage) we cannot use GrantPermissionRule for
 * WRITE_EXTERNAL_STORAGE. DownloadManager handles its own storage access,
 * so we verify downloads via DownloadManager queries and content URIs
 * rather than direct filesystem checks.
 */
@RunWith(AndroidJUnit4::class)
class DownloadManagerTest {

    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val downloadManager: DownloadManager
        get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    // Small test file (~788 KB)
    private val testUrl = "https://www.w3schools.com/html/mov_bbb.mp4"

    // Track download IDs to clean up
    private val downloadIds = mutableListOf<Long>()

    @After
    fun cleanup() {
        // Remove any tracked downloads (also deletes downloaded files)
        downloadIds.forEach { id ->
            try {
                downloadManager.remove(id)
            } catch (_: Exception) {
            }
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /**
     * Polls [DownloadManager] for the given [downloadId] every 2 s,
     * returning the terminal status (SUCCESSFUL or FAILED) or -1 on timeout.
     */
    private fun pollUntilTerminal(downloadId: Long, timeoutSeconds: Int = 60): Int {
        val maxPolls = timeoutSeconds / 2
        for (i in 1..maxPolls) {
            Thread.sleep(2_000)
            val query = DownloadManager.Query().setFilterById(downloadId)
            val cursor = downloadManager.query(query) ?: return -1
            if (!cursor.moveToFirst()) { cursor.close(); return -1 }
            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            cursor.close()
            if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED) {
                return status
            }
        }
        return -1 // timed out
    }

    /**
     * Verifies a completed download via DownloadManager query:
     * checks that the URI is non-null and bytes downloaded > 0.
     */
    private fun assertDownloadedFileValid(downloadId: Long) {
        val uri: Uri? = downloadManager.getUriForDownloadedFile(downloadId)
        assertNotNull("Downloaded file URI should not be null", uri)

        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor = downloadManager.query(query)!!
        assertTrue(cursor.moveToFirst())
        val bytes = cursor.getLong(
            cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
        )
        cursor.close()
        assertTrue("Downloaded file should have bytes > 0", bytes > 0)
    }

    // ---------------------------------------------------------------
    // Tests
    // ---------------------------------------------------------------

    @Test
    fun downloadSmallFileSucceeds() {
        val filename = "test_download_${System.currentTimeMillis()}.mp4"
        val resolved = GestureExecutor.resolveDownloadPath(filename)

        val request = DownloadManager.Request(Uri.parse(testUrl)).apply {
            setTitle(resolved.filename)
            setDescription("DownloadManagerTest")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            setDestinationInExternalPublicDir(resolved.directory, resolved.subPath)
        }

        val downloadId = downloadManager.enqueue(request)
        downloadIds.add(downloadId)

        val status = pollUntilTerminal(downloadId, timeoutSeconds = 60)
        assertEquals("Download should succeed", DownloadManager.STATUS_SUCCESSFUL, status)
        assertDownloadedFileValid(downloadId)
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

        val request = DownloadManager.Request(Uri.parse(testUrl)).apply {
            setTitle(resolved.filename)
            setDescription("DownloadManagerTest – album")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            setDestinationInExternalPublicDir(resolved.directory, resolved.subPath)
        }

        val downloadId = downloadManager.enqueue(request)
        downloadIds.add(downloadId)

        val status = pollUntilTerminal(downloadId, timeoutSeconds = 60)
        assertEquals("Download to album should succeed", DownloadManager.STATUS_SUCCESSFUL, status)
        assertDownloadedFileValid(downloadId)

        // Verify the file landed in the expected location via its content URI
        val uri = downloadManager.getUriForDownloadedFile(downloadId)
        assertNotNull("Album download should produce a valid URI", uri)
    }

    @Test
    fun downloadInvalidUrlFails() {
        val filename = "nonexistent_${System.currentTimeMillis()}.mp4"
        val resolved = GestureExecutor.resolveDownloadPath(filename)

        val request = DownloadManager.Request(Uri.parse("https://example.com/nonexistent.mp4")).apply {
            setTitle(resolved.filename)
            setDescription("DownloadManagerTest – invalid URL")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            setDestinationInExternalPublicDir(resolved.directory, resolved.subPath)
        }

        val downloadId = downloadManager.enqueue(request)
        downloadIds.add(downloadId)

        val status = pollUntilTerminal(downloadId, timeoutSeconds = 60)
        assertEquals("Download of invalid URL should fail", DownloadManager.STATUS_FAILED, status)
    }

    @Test
    fun staleCleanupThenDownloadSucceeds() {
        val filename = "stale_test_${System.currentTimeMillis()}.mp4"
        val resolved = GestureExecutor.resolveDownloadPath(filename)

        // 1. Enqueue a download then immediately remove it (simulates stale entry)
        val staleRequest = DownloadManager.Request(Uri.parse(testUrl)).apply {
            setTitle(resolved.filename)
            setDescription("DownloadManagerTest – stale")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            setDestinationInExternalPublicDir(resolved.directory, resolved.subPath)
        }
        val staleId = downloadManager.enqueue(staleRequest)
        downloadManager.remove(staleId) // immediately cancel / remove

        // Small pause to let DownloadManager settle
        Thread.sleep(1_000)

        // 2. Enqueue the same download again — should succeed without being blocked
        val retryRequest = DownloadManager.Request(Uri.parse(testUrl)).apply {
            setTitle(resolved.filename)
            setDescription("DownloadManagerTest – retry after stale")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            setDestinationInExternalPublicDir(resolved.directory, resolved.subPath)
        }
        val retryId = downloadManager.enqueue(retryRequest)
        downloadIds.add(retryId)

        val status = pollUntilTerminal(retryId, timeoutSeconds = 60)
        assertEquals(
            "Second download after stale cleanup should succeed",
            DownloadManager.STATUS_SUCCESSFUL,
            status
        )
        assertDownloadedFileValid(retryId)
    }
}
