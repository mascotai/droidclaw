package com.thisux.droidclaw.accessibility

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import com.thisux.droidclaw.model.UIElement
import java.security.MessageDigest

object ScreenTreeBuilder {

    fun capture(rootNode: AccessibilityNodeInfo?): List<UIElement> {
        if (rootNode == null) return emptyList()
        val elements = mutableListOf<UIElement>()

        // Get screen dimensions from root node's bounds
        val screenBounds = Rect()
        rootNode.getBoundsInScreen(screenBounds)
        val screenWidth = screenBounds.width()
        val screenHeight = screenBounds.height()

        walkTree(rootNode, elements, depth = 0, parentDesc = "", screenWidth, screenHeight)
        return elements
    }

    private fun walkTree(
        node: AccessibilityNodeInfo,
        elements: MutableList<UIElement>,
        depth: Int,
        parentDesc: String,
        screenWidth: Int,
        screenHeight: Int
    ) {
        try {
            // Skip DroidClaw's own overlay nodes so the agent never sees them
            if (node.packageName?.toString() == "com.thisux.droidclaw") return

            val rect = Rect()
            node.getBoundsInScreen(rect)

            val text = node.text?.toString() ?: ""
            val contentDesc = node.contentDescription?.toString() ?: ""
            val viewId = node.viewIdResourceName ?: ""
            val className = node.className?.toString() ?: ""
            val displayText = text.ifEmpty { contentDesc }

            val isInteractive = node.isClickable || node.isLongClickable ||
                node.isEditable || node.isScrollable || node.isFocusable

            if (isInteractive || displayText.isNotEmpty()) {
                // Check if element is entirely off-screen before processing
                val visibleLeft = rect.left.coerceAtLeast(0)
                val visibleRight = rect.right.coerceAtMost(screenWidth)
                val visibleTop = rect.top.coerceAtLeast(0)
                val visibleBottom = rect.bottom.coerceAtMost(screenHeight)

                // Skip if element is entirely off-screen (no visible portion)
                if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
                    // Element is entirely off-screen — still walk children
                    for (i in 0 until node.childCount) {
                        val child = node.getChild(i) ?: continue
                        try {
                            walkTree(child, elements, depth + 1, className, screenWidth, screenHeight)
                        } finally {
                            child.recycle()
                        }
                    }
                    return
                }

                // Clamp center coordinates to screen bounds
                val centerX = ((rect.left + rect.right) / 2).coerceIn(0, screenWidth - 1)
                val centerY = ((rect.top + rect.bottom) / 2).coerceIn(0, screenHeight - 1)
                val width = rect.width()
                val height = rect.height()

                val action = when {
                    node.isEditable -> "type"
                    node.isScrollable -> "scroll"
                    node.isClickable -> "tap"
                    node.isLongClickable -> "longpress"
                    else -> "read"
                }

                elements.add(
                    UIElement(
                        id = viewId,
                        text = displayText,
                        type = className.substringAfterLast("."),
                        bounds = "[${rect.left},${rect.top}][${rect.right},${rect.bottom}]",
                        center = listOf(centerX, centerY),
                        size = listOf(width, height),
                        clickable = node.isClickable,
                        editable = node.isEditable,
                        enabled = node.isEnabled,
                        checked = node.isChecked,
                        focused = node.isFocused,
                        selected = node.isSelected,
                        scrollable = node.isScrollable,
                        longClickable = node.isLongClickable,
                        password = node.isPassword,
                        hint = node.hintText?.toString() ?: "",
                        action = action,
                        parent = parentDesc,
                        depth = depth
                    )
                )
            }

            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                try {
                    walkTree(child, elements, depth + 1, className, screenWidth, screenHeight)
                } finally {
                    child.recycle()
                }
            }
        } catch (_: Exception) {
            // Node may have been recycled during traversal
        }
    }

    fun computeScreenHash(elements: List<UIElement>): String {
        val digest = MessageDigest.getInstance("MD5")
        for (el in elements) {
            digest.update("${el.id}|${el.text}|${el.center}".toByteArray())
        }
        return digest.digest().joinToString("") { "%02x".format(it) }.take(12)
    }
}
