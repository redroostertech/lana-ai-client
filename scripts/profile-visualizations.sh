#!/bin/bash

###############################################################################
# Performance Profiling Script for LANA AI Visualization Components
#
# Usage: ./scripts/profile-visualizations.sh
#
# This script provides instructions for manual performance profiling
# using Chrome DevTools Performance tab.
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_PAGE="$PROJECT_ROOT/test-performance-visualizations.html"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔬 LANA AI Visualization Performance Profiling"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Opening performance test page in Chrome..."
echo "Test Page: file://$TEST_PAGE"
echo ""

# Check if Chrome is installed
if [ "$(uname)" == "Darwin" ]; then
    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [ ! -f "$CHROME" ]; then
        echo "❌ Google Chrome not found. Please install Chrome."
        exit 1
    fi
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    CHROME="google-chrome"
elif [ "$(expr substr $(uname -s) 1 10)" == "MINGW32_NT" ] || [ "$(expr substr $(uname -s) 1 10)" == "MINGW64_NT" ]; then
    CHROME="chrome.exe"
fi

# Open Chrome with DevTools
echo "Launching Chrome with Performance Profiling..."
"$CHROME" --auto-open-devtools-for-tabs "file://$TEST_PAGE" &

sleep 2

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 PROFILING INSTRUCTIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. CHROME DEVTOOLS PERFORMANCE TAB:"
echo "   • Press Cmd+Option+I (Mac) or F12 (Windows/Linux) to open DevTools"
echo "   • Navigate to the 'Performance' tab"
echo "   • Click the record button (⚫)"
echo "   • Click 'Run All Tests' in the test page"
echo "   • Wait for tests to complete"
echo "   • Stop recording (⏹)"
echo ""
echo "2. ANALYZE PERFORMANCE:"
echo "   • Review the flame graph for bottlenecks"
echo "   • Check 'Main' thread activity"
echo "   • Look for long tasks (> 50ms)"
echo "   • Identify script evaluation time"
echo "   • Check for forced layout/reflow"
echo ""
echo "3. MEMORY PROFILING:"
echo "   • Switch to 'Memory' tab in DevTools"
echo "   • Take heap snapshot before tests"
echo "   • Run tests"
echo "   • Take heap snapshot after tests"
echo "   • Compare snapshots for memory leaks"
echo ""
echo "4. NETWORK ANALYSIS:"
echo "   • Switch to 'Network' tab"
echo "   • Note module loading time"
echo "   • Check waterfall for ES6 module imports"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 PERFORMANCE TARGETS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Initial Load:               < 200ms"
echo "Chart Render (1K points):   < 100ms"
echo "Chart Render (5K points):   < 500ms"
echo "Update Operation:           < 50ms"
echo "Memory Leak:                0 MB (after 100 cycles)"
echo "Concurrent Render (10):     < 500ms"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 TIPS FOR OPTIMIZATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "• Module Loading: Look for ES6 module parse time in Performance tab"
echo "• Rendering: Check Chart.js initialization overhead"
echo "• DOM Operations: Identify unnecessary reflows/repaints"
echo "• Memory: Use Allocation Timeline to find memory leaks"
echo "• Scripting: Look for long-running JavaScript tasks"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Enter when profiling is complete..."
read

echo ""
echo "✅ Profiling session completed."
echo ""
