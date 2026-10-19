package com.alfred.assistant

internal data class MainViewportBounds(val height: Int, val safeTop: Int, val safeBottom: Int)

// Coordinates are physical screen pixels. Only reserve portions that overlap the WebView.
internal fun mainViewportBounds(
    viewTop: Int, viewHeight: Int, windowTop: Int, windowBottom: Int,
    systemTop: Int, systemBottom: Int, keyboardBottom: Int, keyboardVisible: Boolean
): MainViewportBounds {
    val viewBottom = viewTop + viewHeight
    val contentBottom = if (keyboardVisible) windowBottom - keyboardBottom else viewBottom
    val height = (minOf(viewBottom, contentBottom) - viewTop).coerceIn(0, viewHeight)
    return MainViewportBounds(
        height,
        (windowTop + systemTop - viewTop).coerceIn(0, height),
        if (keyboardVisible) 0 else (viewBottom - (windowBottom - systemBottom)).coerceIn(0, height)
    )
}
