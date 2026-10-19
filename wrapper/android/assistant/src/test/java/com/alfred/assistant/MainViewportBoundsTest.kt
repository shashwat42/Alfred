package com.alfred.assistant

import org.junit.Assert.assertEquals
import org.junit.Test

class MainViewportBoundsTest {
    @Test fun edgeToEdgeReservesSystemBars() {
        assertEquals(MainViewportBounds(800, 24, 24), mainViewportBounds(0, 800, 0, 800, 24, 24, 0, false))
    }
    @Test fun keyboardOverlapIsRemovedOnce() {
        assertEquals(MainViewportBounds(500, 24, 0), mainViewportBounds(0, 800, 0, 800, 24, 24, 300, true))
        assertEquals(MainViewportBounds(476, 0, 0), mainViewportBounds(24, 476, 0, 800, 24, 24, 300, true))
    }
    @Test fun alreadyInsetViewDoesNotReserveSystemBarsAgain() {
        assertEquals(MainViewportBounds(752, 0, 0), mainViewportBounds(24, 752, 0, 800, 24, 24, 0, false))
    }
    @Test fun floatingKeyboardAndOffsetWindowsDoNotCreateBlankSpace() {
        assertEquals(MainViewportBounds(480, 0, 0), mainViewportBounds(120, 480, 100, 700, 20, 0, 0, true))
        assertEquals(MainViewportBounds(330, 20, 0), mainViewportBounds(100, 600, 100, 700, 20, 0, 270, true))
    }
}
