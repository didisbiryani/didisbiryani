// Didi's Biryani - Client-Side Anti-Tampering Shield
// loaded at the very top of each page to prevent unauthorized inspection and console injection

(function() {
    // 1. Trigger security override block
    function triggerSecurityAction(reason) {
        if (document.body) {
            document.body.innerHTML = `
                <div style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    background: linear-gradient(135deg, #0f0c20 0%, #15102a 100%);
                    color: #ff4d4d;
                    font-family: 'Outfit', 'Inter', sans-serif;
                    text-align: center;
                    padding: 20px;
                    box-sizing: border-box;
                    user-select: none;
                ">
                    <div style="
                        background: rgba(25, 25, 25, 0.05);
                        border: 1px solid rgba(255, 77, 77, 0.2);
                        border-radius: 24px;
                        padding: 40px;
                        max-width: 500px;
                        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
                        backdrop-filter: blur(10px);
                        -webkit-backdrop-filter: blur(10px);
                    ">
                        <div style="font-size: 64px; margin-bottom: 20px; animation: pulse 2s infinite;">🛡️</div>
                        <h1 style="font-size: 24px; margin-bottom: 10px; color: #fff; font-weight: 800; letter-spacing: 0.5px;">Security Policy Violation</h1>
                        <p style="font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.7); margin-bottom: 25px;">
                            Developer console inspection or tampering attempt has been blocked to protect secure customer transactions.
                        </p>
                        <button onclick="window.location.reload()" style="
                            background: #ff4d4d;
                            color: white;
                            border: none;
                            padding: 12px 30px;
                            border-radius: 12px;
                            font-size: 14px;
                            font-weight: 700;
                            cursor: pointer;
                            box-shadow: 0 0 15px rgba(255, 77, 77, 0.4);
                        ">Reload Page</button>
                    </div>
                </div>
            `;
        } else {
            document.write('Security Violation: Unauthorized element inspection.');
        }
        throw new Error("Security Violation: " + reason);
    }

    // 2. Disable Right-Click Context Menu (Inspect Element)
    window.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
    }, true);

    // 3. Disable Keyboard Developer Shortcuts
    window.addEventListener('keydown', function(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
            (e.ctrlKey && (e.key === 'U' || e.key === 'u')) ||
            (isMac && e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i'))
        ) {
            e.preventDefault();
            e.stopPropagation();
            triggerSecurityAction("Shortcut Blocked");
            return false;
        }
    }, true);

    // 4. Infinite Debugger Loop (Locks console if opened)
    function startDebuggerTrap() {
        setInterval(function() {
            (function() {
                const start = new Date().getTime();
                debugger;
                const end = new Date().getTime();
                if (end - start > 100) {
                    triggerSecurityAction("Console Open Debugger Event");
                }
            })();
        }, 100);
    }
    
    // Start debugger check after page finishes initial render
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDebuggerTrap);
    } else {
        startDebuggerTrap();
    }

    // 5. Size Differential DevTools Detector (Removed due to zoom false-positives)
    // The debugger trap (4) is sufficient for preventing console inspection.
})();
