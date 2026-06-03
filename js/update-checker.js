import { db, doc, onSnapshot } from './firebase-config.js';

// Simple semver compare function
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

function initUpdateChecker() {
    // Check if we are running inside our custom Android App
    const ua = navigator.userAgent;
    const match = ua.match(/DidisCustomerApp\/([\d\.]+)/);
    
    // Also support local testing via localStorage
    const testVersion = localStorage.getItem('TEST_APP_VERSION');
    let installedVersion = match ? match[1] : testVersion;

    // Fallback for older apps that didn't send the version in the User Agent
    const isApp = localStorage.getItem('isAndroidApp') === 'true';
    if (!installedVersion && isApp) {
        installedVersion = "1.0.0";
    }

    if (!installedVersion && !localStorage.getItem('DEBUG_UPDATE')) {
        // Not running inside the app or no version provided, do nothing.
        return;
    }

    // Listen to store settings to get the latest app version and apk download url
    const storeDocRef = doc(db, 'storeSettings', 'info');
    onSnapshot(storeDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const latestVersion = data.latestAppVersion;
            const downloadUrl = data.apkDownloadUrl;

            if (latestVersion && downloadUrl) {
                // If installed version is strictly less than the latest version
                if (compareVersions(installedVersion || "0", latestVersion) < 0) {
                    const modal = document.getElementById('app-update-modal');
                    const versionText = document.getElementById('update-modal-version');
                    const downloadBtn = document.getElementById('update-download-btn');

                    if (modal && versionText && downloadBtn) {
                        versionText.innerText = latestVersion;
                        downloadBtn.href = downloadUrl;
                        
                        if (downloadUrl.includes('play.google.com')) {
                            downloadBtn.removeAttribute('download');
                            downloadBtn.target = '_blank';
                        } else {
                            downloadBtn.setAttribute('download', 'didis_biryani_update.apk');
                        }
                        
                        modal.classList.remove('hidden');
                        modal.classList.add('flex');
                        
                        // We also modify the maybe later button to close the modal properly
                        const maybeLaterBtn = modal.querySelector('button');
                        if (maybeLaterBtn) {
                            maybeLaterBtn.onclick = () => {
                                modal.classList.add('hidden');
                                modal.classList.remove('flex');
                            };
                        }
                    }
                }
            }
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdateChecker);
} else {
    initUpdateChecker();
}
