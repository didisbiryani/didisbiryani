import { db, auth, onAuthStateChanged, collection, addDoc, getDocs, getDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, query, where, increment, runTransaction } from './firebase-config.js';
import { printKOT, printDeliverySlip } from './printer-helper.js';
import { sendInvoiceEmail } from './email-helper.js';
import { addWalletEntry } from './wallet-helper.js';

// Strict Admin Access Control Security Check
const ADMIN_EMAILS = [
    'didisbiryani@gmail.com',
    'admin@gmail.com'
];

onAuthStateChanged(auth, (user) => {
    const loginOverlay = document.getElementById('admin-login-overlay');
    if (loginOverlay) {
        if (!user) {
            // Not logged in -> Show login screen
            loginOverlay.classList.remove('hidden');
        } else {
            // Logged in -> Check if they are an admin
            if (ADMIN_EMAILS.includes(user.email)) {
                // They are an admin -> Hide login screen and let dashboard load
                loginOverlay.classList.add('hidden');
            } else {
                // They are NOT an admin -> Kick them out
                alert("Access Denied: Your email address does not have Admin privileges.");
                signOut(auth);
                loginOverlay.classList.remove('hidden');
            }
        }
    }
});

import { signInWithEmailAndPassword, provider, signInWithGoogle, getRedirectResult, signOut } from './firebase-config.js';

// Consume Google Redirect Sign-In result on Mobile/iOS Safari load
try {
    getRedirectResult(auth).then((result) => {
        if (result && result.user) {
            console.log("Logged in via redirect inside admin successfully!");
        }
    }).catch(e => {
        console.error("Error processing Google redirect login inside admin:", e);
    });
} catch(e) {}

window.handleAdminEmailLogin = async () => {
    const email = document.getElementById('admin-login-email').value.trim();
    const password = document.getElementById('admin-login-pass').value;

    if (!email || !password) {
        showToast("Please enter both email and password.", "error");
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
        showToast("Logged in successfully!", "success");
    } catch (err) {
        console.error("Email login failed", err);
        showToast("Login failed: " + err.message, "error");
    }
};

window.handleAdminGoogleLogin = async () => {
    try {
        await signInWithGoogle(auth, provider);
        showToast("Logged in with Google successfully!", "success");
    } catch (err) {
        console.error("Google login failed", err);
        showToast("Login failed: " + err.message, "error");
    }
};

window.handleLogout = async () => {
    await signOut(auth);
    window.location.reload();
};

// --- Global State ---
let allOrders = [];
let allMenu = [];
let allDeliveryBoys = [];
let allUsers = [];
let allGlobalMessages = [];
let readChats = new Set();
let editingItemId = null;
let viewingOrderId = null;

// --- Security: XSS Sanitizer ---
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// --- Safe Date Formatting Helper ---
function safeFormatDate(timestamp, formatType = 'date') {
    if (!timestamp) return 'N/A';
    const dateObj = new Date(timestamp);
    if (isNaN(dateObj.getTime())) return 'N/A';
    if (formatType === 'date') {
        return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else if (formatType === 'time') {
        return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (formatType === 'datetime') {
        return dateObj.toLocaleString();
    } else if (formatType === 'full') {
        return dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    } else if (formatType === 'short_date') {
        return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } else if (formatType === 'customer_date') {
        return dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } else if (formatType === 'statement_date') {
        return dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return dateObj.toLocaleDateString();
}


// --- Daily Reset Helper ---
function isToday(timestamp) {
    const orderDate = new Date(timestamp);
    const today = new Date();
    return orderDate.getFullYear() === today.getFullYear() &&
        orderDate.getMonth() === today.getMonth() &&
        orderDate.getDate() === today.getDate();
}

function getOrdersForDate(dateStr) {
    return allOrders.filter(o => {
        const d = new Date(o.timestamp);
        const oStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return oStr === dateStr;
    });
}

// --- Analytics & Home Rendering ---
let currentStoreSettings = { isOnline: true, storeMode: 'open', address: "Udharbond, Main Market Road, Near Post Office, Silchar, Assam 788030", assignmentMode: "manual", deliveryCharge: 40, taxPercentage: 5, minOrderForFreeDelivery: 499, contactPhone: '6001572756', instagram: 'didis.biryani', deliveryPaymentMethod: 'razorpay', deliveryUpiId: '', loyaltyActive: true, loyaltyThreshold: 5, loyaltyReward: 50, latestAppVersion: '1.0.0', apkDownloadUrl: '' };

onSnapshot(collection(db, "messages"), (snap) => {
    allGlobalMessages = [];
    snap.forEach(doc => {
        allGlobalMessages.push({ id: doc.id, ...doc.data() });
    });
    allGlobalMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (typeof renderAdminChatList === 'function') {
        renderAdminChatList();
    }
});

onSnapshot(doc(db, "storeSettings", "info"), (docSnap) => {
    if (docSnap.exists()) {
        const data = docSnap.data();
        currentStoreSettings = {
            isOnline: data.isOnline !== undefined ? data.isOnline : true,
            storeMode: data.storeMode || 'open',
            address: data.address || "Udharbond, Main Market Road, Near Post Office, Silchar, Assam 788030",
            assignmentMode: data.assignmentMode || 'manual',
            deliveryCharge: data.deliveryCharge !== undefined ? Number(data.deliveryCharge) : 40,
            taxPercentage: data.taxPercentage !== undefined ? Number(data.taxPercentage) : 5,
            minOrderForFreeDelivery: data.minOrderForFreeDelivery !== undefined ? Number(data.minOrderForFreeDelivery) : 499,
            contactPhone: data.contactPhone || '6001572756',
            instagram: data.instagram || 'didis.biryani',
            deliveryPaymentMethod: data.deliveryPaymentMethod || 'razorpay',
            deliveryUpiId: data.deliveryUpiId || '',
            loyaltyActive: data.loyaltyActive !== undefined ? data.loyaltyActive : true,
            loyaltyThreshold: data.loyaltyThreshold !== undefined ? Number(data.loyaltyThreshold) : 5,
            loyaltyReward: data.loyaltyReward !== undefined ? Number(data.loyaltyReward) : 50,
            latestAppVersion: data.latestAppVersion || '1.0.0',
            apkDownloadUrl: data.apkDownloadUrl || '',
            deliveryZones: data.deliveryZones || [],
            ...data
        };
    } else {
        // Create default if not exists
        setDoc(doc(db, "storeSettings", "info"), currentStoreSettings);
    }
    updateStoreStatusUI();
    if (typeof renderDeliveryZones === 'function') renderDeliveryZones();
});

function updateStoreStatusUI() {
    // Right sidebar widget
    const addrEl = document.getElementById('admin-store-address');
    const btnEl = document.getElementById('admin-store-toggle');
    const cardEl = document.getElementById('admin-store-status-card');

    // Main Tab
    const mainAddrEl = document.getElementById('admin-main-store-address');
    const mainCardEl = document.getElementById('admin-main-store-card');

    if (addrEl) addrEl.innerText = currentStoreSettings.address;
    if (mainAddrEl) mainAddrEl.innerText = currentStoreSettings.address;

    const mode = currentStoreSettings.storeMode || (currentStoreSettings.isOnline ? 'open' : 'closed');
    let effectiveMode = mode;
    if (currentStoreSettings.autoOpenTime && currentStoreSettings.autoCloseTime) {
        const now = new Date();
        const currentStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        let isInsideWindow = false;
        if (currentStoreSettings.autoOpenTime <= currentStoreSettings.autoCloseTime) {
            isInsideWindow = currentStr >= currentStoreSettings.autoOpenTime && currentStr < currentStoreSettings.autoCloseTime;
        } else {
            isInsideWindow = currentStr >= currentStoreSettings.autoOpenTime || currentStr < currentStoreSettings.autoCloseTime;
        }
        if (!isInsideWindow) {
            effectiveMode = 'closed';
        } else if (effectiveMode === 'closed') {
            effectiveMode = 'open';
        }
    }

    // Mode label mapping
    const modeLabels = {
        'open': { short: 'Accepting Orders', long: '🟢 Store is Open', color: 'green', borderClass: 'border-green-500', textClass: 'text-green-500', hoverClass: 'hover:bg-green-500' },
        'no-delivery': { short: 'Take-in Only', long: '🟡 Delivery Paused', color: 'yellow', borderClass: 'border-yellow-500', textClass: 'text-yellow-500', hoverClass: 'hover:bg-yellow-500' },
        'paused': { short: 'Temporarily Paused', long: '🟠 Temporarily Paused', color: 'orange', borderClass: 'border-orange-500', textClass: 'text-orange-500', hoverClass: 'hover:bg-orange-500' },
        'closed': { short: 'Store Closed', long: '🔴 Store is Closed', color: 'red', borderClass: 'border-red-500', textClass: 'text-red-500', hoverClass: 'hover:bg-red-500' }
    };

    const ml = modeLabels[effectiveMode] || modeLabels['open'];

    if (btnEl) {
        btnEl.innerText = ml.short;
        btnEl.className = `flex-1 py-1.5 border ${ml.borderClass} ${ml.textClass} rounded-lg text-xs font-bold ${ml.hoverClass} hover:text-white transition-colors`;
    }
    if (cardEl) {
        if (effectiveMode === 'open') cardEl.classList.remove('opacity-50');
        else cardEl.classList.add('opacity-50');
    }

    if (mainCardEl) {
        if (effectiveMode === 'open') mainCardEl.classList.remove('opacity-50');
        else mainCardEl.classList.add('opacity-50');
    }

    // Update the dropdown select in restaurant Settings tab
    const storeModeSelect = document.getElementById('storeModeSelect');
    if (storeModeSelect) {
        storeModeSelect.value = mode;
    }

    const assignmentSelect = document.getElementById('assignmentModeSelect');
    if (assignmentSelect) {
        assignmentSelect.value = currentStoreSettings.assignmentMode || 'manual';
    }

    // Populate operational settings inputs if they exist in the settings tab
    const settingsStoreMode = document.getElementById('settingsStoreModeSelect');
    const settingsAutoOpenTime = document.getElementById('settingsAutoOpenTime');
    const settingsAutoCloseTime = document.getElementById('settingsAutoCloseTime');
    const settingsAssignMode = document.getElementById('settingsAssignmentModeSelect');
    const settingsAddr = document.getElementById('settingsStoreAddress');
    const settingsAllowedCities = document.getElementById('settingsAllowedCities');
    const settingsAllowedZips = document.getElementById('settingsAllowedZips');
    const settingsDel = document.getElementById('settingsDeliveryCharge');
    const settingsTax = document.getElementById('settingsTaxPercentage');
    const settingsMinFree = document.getElementById('settingsMinOrderFreeDelivery');
    const settingsContact = document.getElementById('settingsStoreContact');
    const settingsInsta = document.getElementById('settingsInstagram');
    const settingsDeliveryPaymentMethod = document.getElementById('settingsDeliveryPaymentMethod');
    const settingsDeliveryUpiId = document.getElementById('settingsDeliveryUpiId');

    if (settingsStoreMode) settingsStoreMode.value = mode;
    if (settingsAutoOpenTime) settingsAutoOpenTime.value = currentStoreSettings.autoOpenTime || '';
    if (settingsAutoCloseTime) settingsAutoCloseTime.value = currentStoreSettings.autoCloseTime || '';
    if (settingsAssignMode) settingsAssignMode.value = currentStoreSettings.assignmentMode || 'manual';
    const settingsAutoPrintSelect = document.getElementById('settingsAutoPrintSelect');
    if (settingsAutoPrintSelect) settingsAutoPrintSelect.value = currentStoreSettings.autoPrint === true ? 'true' : 'false';
    if (settingsAddr) settingsAddr.value = currentStoreSettings.address || '';
    if (settingsAllowedCities) settingsAllowedCities.value = currentStoreSettings.allowedCities || '';
    if (settingsAllowedZips) settingsAllowedZips.value = currentStoreSettings.allowedZips || '';
    if (settingsDel) settingsDel.value = currentStoreSettings.deliveryCharge !== undefined ? currentStoreSettings.deliveryCharge : 40;
    if (settingsTax) settingsTax.value = currentStoreSettings.taxPercentage !== undefined ? currentStoreSettings.taxPercentage : 5;
    if (settingsMinFree) settingsMinFree.value = currentStoreSettings.minOrderForFreeDelivery !== undefined ? currentStoreSettings.minOrderForFreeDelivery : 499;
    if (settingsContact) settingsContact.value = currentStoreSettings.contactPhone || '6001572756';
    if (settingsInsta) settingsInsta.value = currentStoreSettings.instagram || 'didis.biryani';
    if (settingsDeliveryPaymentMethod) {
        settingsDeliveryPaymentMethod.value = currentStoreSettings.deliveryPaymentMethod || 'razorpay';
        if (typeof toggleUpiInput === 'function') toggleUpiInput();
    }
    if (settingsDeliveryUpiId) settingsDeliveryUpiId.value = currentStoreSettings.deliveryUpiId || '';

    const settingsLatestAppVersion = document.getElementById('settingsLatestAppVersion');
    const settingsApkDownloadUrl = document.getElementById('settingsApkDownloadUrl');
    if (settingsLatestAppVersion) settingsLatestAppVersion.value = currentStoreSettings.latestAppVersion || '';
    if (settingsApkDownloadUrl) settingsApkDownloadUrl.value = currentStoreSettings.apkDownloadUrl || '';

    // Loyalty Settings Inputs
    const settingsLoyaltyActive = document.getElementById('loyaltyActive');
    const settingsLoyaltyThreshold = document.getElementById('loyaltyThreshold');
    const settingsLoyaltyReward = document.getElementById('loyaltyReward');
    const settingsLoyaltyExpiryDays = document.getElementById('loyaltyExpiryDays');

    if (settingsLoyaltyActive) settingsLoyaltyActive.checked = currentStoreSettings.loyaltyActive !== false;
    if (settingsLoyaltyThreshold) settingsLoyaltyThreshold.value = currentStoreSettings.loyaltyThreshold || 5;
    if (settingsLoyaltyReward) settingsLoyaltyReward.value = currentStoreSettings.loyaltyReward || 50;
    if (settingsLoyaltyExpiryDays) settingsLoyaltyExpiryDays.value = currentStoreSettings.loyaltyExpiryDays || 0;
}

window.updateAssignmentMode = async (mode) => {
    try {
        await updateDoc(doc(db, "storeSettings", "info"), { assignmentMode: mode });
    } catch (e) {
        console.error("Error updating assignment mode", e);
        alert("Failed to save assignment mode.");
    }
};

window.updateStoreMode = async (mode) => {
    const isOnline = (mode === 'open' || mode === 'no-delivery');
    await setDoc(doc(db, "storeSettings", "info"), {
        storeMode: mode,
        isOnline: isOnline
    }, { merge: true });
};

// Legacy toggle for sidebar widget (cycles through modes)
window.toggleStoreStatus = async () => {
    const modes = ['open', 'no-delivery', 'paused', 'closed'];
    const currentMode = currentStoreSettings.storeMode || (currentStoreSettings.isOnline ? 'open' : 'closed');
    const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
    await updateStoreMode(modes[nextIndex]);
};

// Clear only Delivered / Collected orders from screen (localStorage)
window.clearDeliveredOrders = async () => {
    // Only target delivered/collected orders that are currently showing (i.e. from today)
    const delivered = allOrders.filter(o => (o.status === 'Delivered' || o.status === 'Collected') && isToday(o.timestamp));

    // Get already cleared orders to not clear them again if they are the only ones
    const clearedStr = localStorage.getItem('clearedDeliveredOrders') || '[]';
    let clearedList = [];
    try { clearedList = JSON.parse(clearedStr); } catch (e) { }

    const toClear = delivered.filter(o => !clearedList.includes(o.id));

    if (toClear.length === 0) {
        showToast('No delivered orders on screen to clear.', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to clear ${toClear.length} delivered/collected order(s) from your screen? They will still be visible in Order History and to customers.`)) return;

    // Add to localStorage
    const newList = [...clearedList, ...toClear.map(o => o.id)];
    localStorage.setItem('clearedDeliveredOrders', JSON.stringify(newList));

    showToast(`Cleared ${toClear.length} delivered order(s) from screen.`, 'success');

    // Re-render
    renderAdminOrders();
};

window.editStoreAddress = async () => {
    const newAddr = prompt("Enter new restaurant address:", currentStoreSettings.address);
    if (newAddr && newAddr.trim() !== "") {
        await setDoc(doc(db, "storeSettings", "info"), {
            address: newAddr.trim()
        }, { merge: true });
    }
};

function renderDashboardHome() {
    // Only count TODAY's orders for dashboard stats
    const todayOrders = allOrders.filter(o => isToday(o.timestamp));

    let revenue = 0;
    let pendingCount = 0;

    todayOrders.forEach(o => {
        revenue += Number(o.total || 0);
        if (o.status === 'Pending') pendingCount++;
    });

    document.getElementById('stat-revenue').innerText = `₹${revenue}`;
    document.getElementById('right-balance').innerText = `₹${revenue}`;
    document.getElementById('stat-orders').innerText = todayOrders.length;
    document.getElementById('stat-pending').innerText = pendingCount;
    document.getElementById('stat-items').innerText = allMenu.length;

    // Recent Orders Grid (Home Tab) - Top 4 TODAY
    const recentGrid = document.getElementById('dashboard-recent-orders');
    recentGrid.innerHTML = '';
    if (todayOrders.length === 0) {
        recentGrid.innerHTML = `<div class="col-span-full text-center py-12"><p class="text-brand-white/30 text-lg font-bold">🌅 New day, fresh start!</p><p class="text-brand-white/20 text-sm mt-2">No orders yet today.</p></div>`;
    }
    todayOrders.slice(0, 4).forEach(o => {
        const date = safeFormatDate(o.timestamp, 'date');
        recentGrid.innerHTML += `
            <div class="glass border border-white/10 rounded-2xl p-6 hover:border-brand-gold/30 transition-colors">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h4 class="font-bold text-brand-white truncate max-w-[120px]">${escapeHTML(o.customer)}</h4>
                        <p class="text-xs text-brand-white/50">${date}</p>
                    </div>
                    <span class="px-2 py-1 bg-white/10 text-white rounded text-xs font-bold">${o.status}</span>
                </div>
                <div class="text-2xl font-black text-brand-gold mb-4">₹${o.total}</div>
                <button onclick="viewOrderDetails('${o.id}')" class="w-full py-2 bg-white/5 text-brand-white text-xs font-bold rounded-lg hover:bg-white/10 transition-colors">View Details</button>
            </div>
        `;
    });

    // Live Orders Feed (Right Sidebar) - Top 6 TODAY
    const liveFeed = document.getElementById('right-live-orders');
    liveFeed.innerHTML = '';
    if (todayOrders.length === 0) {
        liveFeed.innerHTML = `<p class="text-brand-white/30 text-sm text-center py-4">No orders yet today.</p>`;
    }
    todayOrders.slice(0, 6).forEach(o => {
        let itemsSummary = '';
        if (o.items && o.items.length > 0) {
            itemsSummary = o.items.map(i => `${i.quantity}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''}${i.quantityLabel ? ` [${i.quantityLabel}]` : ''}`).join(', ');
        }
        liveFeed.innerHTML += `
            <div onclick="viewOrderDetails('${o.id}')" class="flex gap-4 items-center p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/10">
                <div class="w-10 h-10 rounded-full bg-brand-gold/20 text-brand-gold flex items-center justify-center font-bold flex-shrink-0">
                    ${o.customer.charAt(0).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                    <h5 class="text-sm font-bold text-brand-white truncate">${o.customer}</h5>
                    <p class="text-xs text-brand-white/50 truncate">${itemsSummary}</p>
                </div>
                <div class="text-brand-gold font-bold text-sm">₹${o.total}</div>
            </div>
        `;
    });
}

// --- Menu Management ---
const menuCol = collection(db, "menu");

window.deleteMenuItem = async (id) => {
    if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menu", id));
    }
};

window.updateMenuStatus = async (id, status) => {
    await updateDoc(doc(db, "menu", id), { status });
};

function renderAdminMenu() {
    const manageList = document.getElementById('admin-manage-menu-list');
    const dailyList = document.getElementById('admin-daily-menu-list');

    if (manageList) manageList.innerHTML = '';
    if (dailyList) dailyList.innerHTML = '';

    allMenu.forEach(item => {
        // Defaults to true if undefined
        const isAvailable = item.isAvailable !== false;

        // Build offer tag and pricing HTML for admin cards
        const offerBadgeHtml = item.offerTag ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-brand-red/20 text-brand-red border border-brand-red/30 uppercase">${item.offerTag}</span>` : '';
        const originalPriceHtml = item.originalPrice ? `<span class="text-sm text-brand-white/40 line-through mr-1">₹${item.originalPrice}</span>` : '';
        const qtyLabelHtml = item.quantityLabel ? `<span class="text-[10px] text-brand-gold/70 font-bold">${item.quantityLabel}</span>` : '';
        const variantsCountHtml = item.variants && item.variants.length > 0 ? `<span class="text-[10px] text-brand-white/40 ml-1">(${item.variants.length} variants)</span>` : '';

        // 1. Render Manage Menu Card
        if (manageList) {
            manageList.innerHTML += `
                <div class="bg-white/5 border border-white/10 hover:border-brand-gold/50 rounded-2xl p-5 flex flex-col group transition-colors relative">
                    <button onclick="deleteMenuItem('${item.id}')" class="absolute top-4 left-4 w-8 h-8 flex items-center justify-center bg-black/50 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors border border-red-500/30 z-10" title="Permanently Delete">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                    <button onclick="editMenuItem('${item.id}')" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-black/50 text-brand-gold hover:bg-brand-gold hover:text-black rounded-lg transition-colors border border-brand-gold/30 z-10" title="Edit Item">
                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                    </button>
                    <div class="flex gap-4 items-start mb-4 mt-8">
                        <img src="${item.image || 'https://via.placeholder.com/100'}" class="w-16 h-16 rounded-xl object-cover">
                        <div class="flex-1">
                            <h4 class="font-bold text-brand-white">${item.name} ${variantsCountHtml}</h4>
                            <p class="text-xs text-brand-white/50">${item.category}</p>
                            <div class="flex items-center gap-1 mt-1">
                                ${originalPriceHtml}
                                <span class="text-lg font-black text-brand-gold">₹${item.price}</span>
                            </div>
                            ${qtyLabelHtml}
                            ${offerBadgeHtml ? `<div class="mt-1">${offerBadgeHtml}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        // 2. Render Daily Menu Card
        if (dailyList) {
            const status = item.status || (item.isAvailable === false ? 'Offline' : 'Available');
            let badgeHtml = '';
            let cardOpacity = '';

            if (status === 'Available') {
                badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-500 border border-green-500/30">Available</span>`;
                cardOpacity = 'border-white/10 hover:border-brand-gold/50';
            } else if (status === 'Out of Stock') {
                badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">Out of Stock</span>`;
                cardOpacity = 'border-yellow-500/30 opacity-80';
            } else {
                badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-500 border border-red-500/30">Offline</span>`;
                cardOpacity = 'border-red-500/30 opacity-60';
            }

            dailyList.innerHTML += `
                <div class="bg-white/5 border ${cardOpacity} rounded-2xl p-5 flex flex-col group transition-colors relative">
                    <div class="absolute top-4 right-4">
                        ${badgeHtml}
                    </div>
                    <div class="flex gap-4 items-start mb-4 mt-2">
                        <img src="${item.image || 'https://via.placeholder.com/100'}" class="w-16 h-16 rounded-xl object-cover">
                        <div class="flex-1">
                            <h4 class="font-bold text-brand-white">${item.name}</h4>
                            <p class="text-xs text-brand-white/50">${item.category}</p>
                            <div class="flex items-center gap-1 mt-1">
                                ${originalPriceHtml}
                                <span class="text-lg font-black text-brand-gold">₹${item.price}</span>
                            </div>
                            ${item.offerTag ? `<span class="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-black bg-brand-red/20 text-brand-red border border-brand-red/30 uppercase">${item.offerTag}</span>` : ''}
                        </div>
                    </div>
                    <div class="mt-auto flex gap-2">
                        <select onchange="updateMenuStatus('${item.id}', this.value)" class="w-full bg-black/50 border border-white/10 text-brand-white rounded-lg px-2 py-2 text-xs font-bold focus:outline-none cursor-pointer text-center appearance-none">
                            <option value="Available" ${status === 'Available' ? 'selected' : ''}>Set Available</option>
                            <option value="Out of Stock" ${status === 'Out of Stock' ? 'selected' : ''}>Set Out of Stock</option>
                            <option value="Offline" ${status === 'Offline' ? 'selected' : ''}>Set Offline</option>
                        </select>
                    </div>
                </div>
            `;
        }
    });
    if (window.lucide) lucide.createIcons();
}

// Customization Logic for Menu Form
let custGroupCount = 0;
window.addCustomizationGroup = () => {
    const builder = document.getElementById('customization-builder');
    const index = custGroupCount++;

    const div = document.createElement('div');
    div.className = 'bg-black/40 p-4 rounded-xl border border-white/5 mb-4 relative cust-group-block';
    div.innerHTML = `
        <input type="text" placeholder="Group Name (e.g. Spice Level)" class="w-full bg-transparent border-b border-white/20 text-white font-bold mb-3 focus:outline-none focus:border-brand-gold pb-1 text-sm group-name-input">
        <div id="options-container-${index}" class="space-y-2 mb-3 options-container"></div>
        <button type="button" onclick="addOption(${index})" class="text-xs text-brand-gold font-bold hover:text-white">+ Add Option</button>
    `;
    builder.appendChild(div);
};

window.addOption = (gIdx) => {
    const container = document.getElementById(`options-container-${gIdx}`);
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'flex gap-2 option-row';
    div.innerHTML = `
        <input type="text" placeholder="Option Name" class="flex-1 bg-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none opt-name-input">
        <input type="number" placeholder="+₹0" class="w-20 bg-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none opt-price-input">
        <input type="number" placeholder="Max (e.g. 1)" class="w-24 bg-white/10 rounded px-2 py-1 text-xs text-brand-gold focus:outline-none opt-limit-input" title="Max selection limit for this option">
    `;
    container.appendChild(div);
};

// Variant Builder Logic (Half Plate / Full Plate etc)
window.addVariantRow = (label = '', price = '') => {
    const builder = document.getElementById('variants-builder');
    if (!builder) return;

    const div = document.createElement('div');
    div.className = 'flex gap-3 items-center variant-row';
    div.innerHTML = `
        <input type="text" placeholder="e.g. Half Plate" value="${label}" class="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-gold variant-label-input">
        <input type="number" placeholder="₹ Price" value="${price}" class="w-28 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-gold variant-price-input">
        <button type="button" onclick="removeVariantRow(this)" class="w-8 h-8 flex items-center justify-center bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors border border-red-500/30" title="Remove Variant">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;
    builder.appendChild(div);
    if (window.lucide) lucide.createIcons();
};

window.removeVariantRow = (btn) => {
    const row = btn.closest('.variant-row');
    if (row) row.remove();
};

function readVariantsFromDOM() {
    const variants = [];
    const rows = document.querySelectorAll('.variant-row');
    rows.forEach(row => {
        const label = row.querySelector('.variant-label-input').value.trim();
        const price = Number(row.querySelector('.variant-price-input').value) || 0;
        if (label !== '') {
            variants.push({ label, price });
        }
    });
    return variants;
}

document.getElementById('add-menu-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        // Read customizations directly from DOM to avoid sync issues
        const customizations = [];
        const groupBlocks = document.querySelectorAll('.cust-group-block');
        groupBlocks.forEach(block => {
            const groupName = block.querySelector('.group-name-input').value.trim();
            if (groupName === '') return;

            const options = [];
            const optionRows = block.querySelectorAll('.option-row');
            optionRows.forEach(row => {
                const optName = row.querySelector('.opt-name-input').value.trim();
                const optPrice = Number(row.querySelector('.opt-price-input').value) || 0;
                const optLimit = parseInt(row.querySelector('.opt-limit-input').value) || 0;
                if (optName !== '') {
                    options.push({ name: optName, price: optPrice, limit: optLimit });
                }
            });

            if (options.length > 0) {
                customizations.push({ name: groupName, options: options });
            }
        });

        const categorySelectVal = document.getElementById('foodCategory').value;
        let finalCategory = categorySelectVal;
        if (categorySelectVal === '__custom__') {
            const customVal = document.getElementById('customFoodCategory').value.trim();
            if (!customVal) {
                showToast("Please enter a custom category name!", "error");
                return;
            }
            finalCategory = customVal;
        }

        // Read variants from DOM
        const variants = readVariantsFromDOM();

        // Read new offer/pricing fields
        const originalPriceVal = document.getElementById('foodOriginalPrice').value;
        const offerTag = document.getElementById('foodOfferTag').value.trim();
        const offerDescription = document.getElementById('foodOfferDesc').value.trim();
        const quantityLabel = document.getElementById('foodQuantityLabel').value.trim();

        const data = {
            name: document.getElementById('foodName').value,
            // Automatically use the first variant's price as the base price if variants exist, to avoid double pricing
            price: variants.length > 0 ? variants[0].price : Number(document.getElementById('foodPrice').value),
            category: finalCategory,
            isVeg: document.getElementById('foodVeg').value === 'true',
            description: document.getElementById('foodDesc').value,
            image: document.getElementById('foodImage').value,
            prepTime: document.getElementById('foodPrepTime') ? document.getElementById('foodPrepTime').value.trim() : '',
            status: 'Available',
            customizations: customizations,
            originalPrice: originalPriceVal ? Number(originalPriceVal) : null,
            offerTag: offerTag || null,
            offerDescription: offerDescription || null,
            quantityLabel: quantityLabel || null,
            variants: variants.length > 0 ? variants : null
        };

        if (editingItemId) {
            await updateDoc(doc(db, "menu", editingItemId), data);
            showToast('Menu Item Updated!', 'success');
            cancelEdit();
        } else {
            await addDoc(menuCol, data);
            document.getElementById('add-menu-form').reset();
            document.getElementById('customization-builder').innerHTML = '';
            document.getElementById('variants-builder').innerHTML = '';
            custGroupCount = 0;
            showToast('Menu Item Added!', 'success');
        }
    } catch (err) {
        console.error('Error saving menu item:', err);
        showToast('Error: ' + err.message, 'error');
    }
});

window.cancelEdit = () => {
    editingItemId = null;
    document.getElementById('add-menu-form').reset();
    document.getElementById('customization-builder').innerHTML = '';
    document.getElementById('variants-builder').innerHTML = '';
    custGroupCount = 0;
    document.getElementById('menu-submit-btn').innerText = 'Add to Menu';
    document.getElementById('menu-cancel-btn').classList.add('hidden');

    // Reset custom category input visibility
    const customInput = document.getElementById('customFoodCategory');
    if (customInput) {
        customInput.classList.add('hidden');
        customInput.value = '';
    }

    // Reset new offer/pricing fields
    document.getElementById('foodOriginalPrice').value = '';
    document.getElementById('foodOfferTag').value = '';
    document.getElementById('foodOfferDesc').value = '';
    document.getElementById('foodQuantityLabel').value = '';
};

window.editMenuItem = (id) => {
    const item = allMenu.find(i => i.id === id);
    if (!item) return;

    editingItemId = id;

    document.getElementById('foodName').value = item.name || '';
    document.getElementById('foodPrice').value = item.price || '';

    // Set category. Since dropdown is built dynamically, item.category is already in option list.
    const catSelect = document.getElementById('foodCategory');
    if (catSelect) {
        catSelect.value = item.category || 'Biryani';
    }
    // Hide custom input when editing
    const customInput = document.getElementById('customFoodCategory');
    if (customInput) {
        customInput.classList.add('hidden');
        customInput.value = '';
    }
    document.getElementById('foodVeg').value = item.isVeg === true || item.isVeg === 'true' ? 'true' : 'false';
    document.getElementById('foodDesc').value = item.description || '';
    document.getElementById('foodImage').value = item.image || '';
    if (document.getElementById('foodPrepTime')) {
        document.getElementById('foodPrepTime').value = item.prepTime || '';
    }

    // Populate new offer/pricing fields
    document.getElementById('foodOriginalPrice').value = item.originalPrice || '';
    document.getElementById('foodOfferTag').value = item.offerTag || '';
    document.getElementById('foodOfferDesc').value = item.offerDescription || '';
    document.getElementById('foodQuantityLabel').value = item.quantityLabel || '';

    // Rebuild variants
    document.getElementById('variants-builder').innerHTML = '';
    if (item.variants && item.variants.length > 0) {
        item.variants.forEach(v => {
            addVariantRow(v.label, v.price);
        });
    }

    // Rebuild customizations
    document.getElementById('customization-builder').innerHTML = '';
    custGroupCount = 0;

    if (item.customizations && item.customizations.length > 0) {
        item.customizations.forEach(group => {
            const gIdx = custGroupCount;
            addCustomizationGroup();

            // update the input field visually
            const groupInputs = document.getElementById('customization-builder').querySelectorAll('.group-name-input');
            if (groupInputs[gIdx]) groupInputs[gIdx].value = group.name;

            group.options.forEach(opt => {
                addOption(gIdx);

                // update the input fields visually
                const container = document.getElementById(`options-container-${gIdx}`);
                const optionRows = container.querySelectorAll('.option-row');
                const lastRow = optionRows[optionRows.length - 1];
                if (lastRow) {
                    lastRow.querySelector('.opt-name-input').value = opt.name;
                    lastRow.querySelector('.opt-price-input').value = opt.price;
                    if (opt.limit) lastRow.querySelector('.opt-limit-input').value = opt.limit;
                }
            });
        });
    }

    document.getElementById('menu-submit-btn').innerText = 'Update Item';
    document.getElementById('menu-cancel-btn').classList.remove('hidden');

    // Scroll to top
    const formEl = document.getElementById('add-menu-form');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// --- Orders Management ---
const ordersCol = collection(db, "orders");
let currentOrderFilter = 'All';

window.filterOrders = (status) => {
    currentOrderFilter = status;
    ['All', 'Pending', 'Accepted', 'Cooking', 'Ready for Delivery', 'Ready to Collect', 'Delivered', 'Collected', 'Rejected'].forEach(f => {
        const btn = document.getElementById('filter-' + f);
        if (!btn) return;
        if (f === status) {
            btn.className = "px-4 py-2 rounded-lg text-sm font-bold bg-brand-gold text-black transition-colors flex-shrink-0";
        } else {
            btn.className = "px-4 py-2 rounded-lg text-sm font-bold text-brand-white/70 hover:text-white transition-colors flex-shrink-0";
        }
    });
    renderAdminOrders();
};

let pendingRejectOrderId = null;
let chosenRejectReason = "";

window.closeRejectModal = () => {
    const modal = document.getElementById('reject-reason-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    pendingRejectOrderId = null;
    chosenRejectReason = "";
    document.getElementById('custom-reject-input').value = "";
    renderAdminOrders();
};

window.selectRejectReason = (reason) => {
    chosenRejectReason = reason;
    document.getElementById('custom-reject-input').value = reason;
};

window.confirmOrderRejection = async () => {
    if (!pendingRejectOrderId) return;

    const customInput = document.getElementById('custom-reject-input').value.trim();
    const finalReason = customInput || chosenRejectReason || "Order rejected by store manager";

    try {
        await updateDoc(doc(db, "orders", pendingRejectOrderId), {
            status: 'Rejected',
            cancellationReason: finalReason
        });
        showToast("Order rejected successfully.", "success");
    } catch (e) {
        console.error("Error rejecting order", e);
        showToast("Failed to reject order.", "error");
    } finally {
        window.closeRejectModal();
    }
};

window.updateOrderStatus = async (id, status) => {
    if (status === 'Rejected') {
        pendingRejectOrderId = id;
        chosenRejectReason = "";
        const modal = document.getElementById('reject-reason-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            if (window.lucide) lucide.createIcons();
        }
        return;
    }

    await updateDoc(doc(db, "orders", id), { status });
    const activeOrderObj = allOrders.find(o => o.id === id);

    // Thermal Printer Auto-Print
    if (activeOrderObj && currentStoreSettings.autoPrint === true) {
        if (status === 'Accepted') {
            printKOT(activeOrderObj);
        } else if (status === 'Ready for Delivery' || status === 'Ready to Collect') {
            printDeliverySlip(activeOrderObj);
        }
    }

    // Push Notification Trigger
    if (activeOrderObj && activeOrderObj.userId && (status === 'Out for Delivery' || status === 'Delivered')) {
        try {
            const userDoc = await getDoc(doc(db, "users", activeOrderObj.userId));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                if (userData.fcmToken) {
                    const messageTitle = status === 'Out for Delivery' ? '🚚 Order Out for Delivery!' : '✅ Order Delivered!';
                    const messageBody = status === 'Out for Delivery' ? 'Your biryani is on the way!' : 'Enjoy your meal! Thank you for ordering from Didis Biryani.';

                    const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
                    const pushUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/send-push' : '/api/send-push';
                    fetch(pushUrl, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': token ? `Bearer ${token}` : ''
                        },
                        body: JSON.stringify({
                            token: userData.fcmToken,
                            title: messageTitle,
                            body: messageBody,
                            data: { orderId: id }
                        })
                    }).catch(err => console.error("Push Notification Error:", err));
                }
            }
        } catch (err) {
            console.error("Error fetching user token:", err);
        }
    }

    // Loyalty Reward Trigger
    if (activeOrderObj && activeOrderObj.userId && (status === 'Delivered' || status === 'Collected')) {
        const threshold = currentStoreSettings.loyaltyThreshold || 5;
        const reward = currentStoreSettings.loyaltyReward || 50;
        const isActive = currentStoreSettings.loyaltyActive !== false;
        const expiryDays = currentStoreSettings.loyaltyExpiryDays || 0;

        if (isActive) {
            // Count completed orders including this one
            const completedCount = allOrders.filter(o =>
                o.userId === activeOrderObj.userId &&
                ['Delivered', 'Collected'].includes(o.status) &&
                o.id !== id
            ).length + 1;

            if (completedCount % threshold === 0) {
                try {
                    let expiryDate = 'never';
                    if (expiryDays > 0) {
                        const exp = new Date();
                        exp.setDate(exp.getDate() + expiryDays);
                        expiryDate = exp.toISOString().split('T')[0];
                    }
                    await addWalletEntry(activeOrderObj.userId, reward, expiryDate, 'loyalty');
                    showToast(`Milestone Reached! Credited ₹${reward} reward to customer wallet.`, "success");
                } catch (e) {
                    console.error("Error triggering loyalty reward", e);
                }
            }
        }
    }

    // Automatically email invoice when marked as Delivered
    if (status === 'Delivered' && activeOrderObj) {
        sendInvoiceEmail(activeOrderObj);
    }

    // If we are currently viewing this order in details tab, re-render it
    if (activeOrderObj && document.getElementById('tab-order-details').classList.contains('hidden') === false) {
        // Just update status display locally to prevent full re-render flicker
        document.getElementById('detail-tx-status').innerText = status;
        renderOrderProgress(status, activeOrderObj.orderType);
    }
};

function renderAdminOrders() {
    const list = document.getElementById('admin-orders-list');
    list.innerHTML = '';

    // Show ALL active (non-completed) orders + today's completed ones
    // This prevents pending/cooking orders from disappearing at midnight
    const completedStatuses = ['Delivered', 'Collected', 'Rejected'];

    const clearedStr = localStorage.getItem('clearedDeliveredOrders') || '[]';
    let clearedList = [];
    try { clearedList = JSON.parse(clearedStr); } catch (e) { }

    const activeOrders = allOrders.filter(o => {
        if (completedStatuses.includes(o.status)) {
            // Only show completed orders from today, and only if they haven't been manually cleared
            return isToday(o.timestamp) && !clearedList.includes(o.id);
        }
        // Always show in-progress orders regardless of date
        return true;
    });

    let filteredOrders = activeOrders;
    if (currentOrderFilter !== 'All') {
        filteredOrders = activeOrders.filter(o => o.status === currentOrderFilter);
    }

    document.getElementById('orders-count-title').innerText = `Showing ${filteredOrders.length} out of ${activeOrders.length} active`;

    if (filteredOrders.length === 0) {
        list.innerHTML = `<div class="col-span-full text-center py-16"><div class="text-5xl mb-4">📋</div><p class="text-brand-white/30 text-lg font-bold">No orders to show</p><p class="text-brand-white/20 text-sm mt-2">Orders will appear here as they come in.</p></div>`;
    }

    const preparationStatuses = ['Pending', 'Accepted', 'Cooking'];
    const prepMap = {};
    activeOrders.forEach(o => {
        if (preparationStatuses.includes(o.status)) {
            (o.items || []).forEach(i => {
                let key = i.name;
                if (i.variantLabel) key += ` - ${i.variantLabel}`;
                if (i.quantityLabel) key += ` [${i.quantityLabel}]`;
                if (i.customizations) {
                     const custStr = Object.values(i.customizations).join(', ');
                     if (custStr) key += ` (${custStr})`;
                }
                if (!prepMap[key]) prepMap[key] = 0;
                prepMap[key] += Number(i.quantity);
            });
        }
    });

    const prepContainer = document.getElementById('admin-preparation-summary');
    const prepList = document.getElementById('preparation-summary-list');
    if (prepContainer && prepList) {
        const keys = Object.keys(prepMap);
        if (keys.length > 0) {
            prepContainer.classList.remove('hidden');
            prepList.innerHTML = keys.map(k => `
                <div class="bg-black/50 border border-brand-gold/30 rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-grow min-w-[200px]">
                    <span class="text-sm font-bold text-brand-white">${escapeHTML(k)}</span>
                    <span class="text-lg font-black text-brand-gold bg-brand-gold/10 px-2 py-0.5 rounded shadow-inner border border-brand-gold/20">${prepMap[k]}</span>
                </div>
            `).join('');
        } else {
            prepContainer.classList.add('hidden');
            prepList.innerHTML = '';
        }
    }

    filteredOrders.forEach(o => {
        const dateStr = safeFormatDate(o.timestamp, 'short_date');
        const timeStr = safeFormatDate(o.timestamp, 'time');

        // Status Badge Style
        let statusBadgeClass = 'bg-white/10 text-brand-white';
        if (o.status === 'Delivered' || o.status === 'Collected') statusBadgeClass = 'bg-green-500/20 text-green-500';
        else if (o.status === 'Pending') statusBadgeClass = 'bg-yellow-500/20 text-yellow-500';
        else if (o.status === 'Accepted') statusBadgeClass = 'bg-blue-500/20 text-blue-500';
        else if (o.status === 'Cooking') statusBadgeClass = 'bg-brand-gold/20 text-brand-gold';
        else if (o.status === 'Ready for Delivery' || o.status === 'Ready to Collect') statusBadgeClass = 'bg-orange-500/20 text-orange-500';
        else if (o.status === 'Out for Delivery') statusBadgeClass = 'bg-purple-500/20 text-purple-500';

        // Limit to 3 items for the card preview
        const previewItems = (o.items || []).slice(0, 3);
        const moreCount = (o.items || []).length - 3;

        let itemsHtml = previewItems.map(i => {
            const custStr = i.customizations ? Object.values(i.customizations).join(', ') : '';
            return `
            <div class="flex items-center justify-between gap-4">
                <div class="flex items-center gap-3 w-full min-w-0">
                    <div class="w-10 h-10 bg-black/50 rounded-lg overflow-hidden flex-shrink-0">
                        <img src="${i.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=150'}" class="w-full h-full object-cover opacity-80">
                    </div>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-bold text-brand-white truncate">${i.name}${i.variantLabel ? ` <span class="text-brand-gold text-xs font-normal">— ${i.variantLabel}</span>` : ''}</p>
                        ${i.quantityLabel ? `<p class="text-[10px] text-brand-gold/70 font-bold mt-0.5">${i.quantityLabel}</p>` : ''}
                        ${custStr ? `<p class="text-[10px] text-brand-gold truncate">${custStr}</p>` : ''}
                        <p class="text-[10px] text-brand-white/50 mt-0.5">x${i.quantity}</p>
                    </div>
                </div>
                <div class="text-sm font-bold text-brand-white/70">₹${i.price}</div>
            </div>
            `;
        }).join('');

        if (moreCount > 0) {
            itemsHtml += `<p class="text-xs text-brand-gold italic mt-2">+ ${moreCount} more item(s)</p>`;
        }

        list.innerHTML += `
            <div class="glass border border-white/10 rounded-3xl p-6 flex flex-col hover:border-brand-gold/30 transition-colors">
                <!-- Header -->
                <div class="flex justify-between items-start mb-6">
                    <div class="min-w-0 pr-2">
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 class="text-xl font-bold text-brand-white max-w-[120px] truncate">${o.customer}</h4>
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${o.orderType === 'pickup' ? 'bg-blue-500/20 text-blue-500' : 'bg-brand-gold/20 text-brand-gold'} border border-current flex-shrink-0">${o.orderType === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${o.isManual ? 'bg-orange-500/20 text-orange-500 border-orange-500/30' : 'bg-green-500/20 text-green-500 border-green-500/30'} border flex-shrink-0">${o.isManual ? 'Manual' : 'Online'}</span>
                            ${o.paymentMethod === 'Cash on Delivery'
                ? `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-green-500/20 text-green-400 border border-green-500/50 flex-shrink-0 shadow-[0_0_10px_rgba(34,197,94,0.2)]">💵 Collect Cash</span>`
                : `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-white/5 text-brand-white/40 border border-white/10 flex-shrink-0">Paid Online</span>`}
                        </div>
                        <div class="flex items-center gap-3 mt-1">
                            <p class="text-xs font-bold text-brand-gold">#${o.orderNumber ? String(o.orderNumber).padStart(5, '0') : 'ORD' + o.id.substring(0, 6).toUpperCase()}</p>
                            ${(() => {
                if (o.orderType !== 'pickup' && o.deliveryBoyId) {
                    const boy = allDeliveryBoys.find(b => b.id === o.deliveryBoyId);
                    if (boy) {
                        return `<div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-brand-gold/10 border border-brand-gold/20">
                                                    <i data-lucide="bike" class="w-3 h-3 text-brand-gold"></i>
                                                    <span class="text-[10px] font-bold text-brand-gold">${boy.name} <a href="tel:${boy.phone}" class="hover:text-white underline ml-1">${boy.phone}</a></span>
                                                </div>`;
                    }
                }
                return '';
            })()}
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <p class="text-[10px] text-brand-white/50 mb-2">${dateStr} ${timeStr}</p>
                        <span class="px-3 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass} border border-current">${o.status}</span>
                    </div>
                </div>
                
                <!-- Items -->
                <div class="flex-1 space-y-4 mb-6">
                    <p class="text-xs font-bold text-brand-white/50 uppercase tracking-widest">Items</p>
                    ${itemsHtml}
                </div>
                
                <!-- Footer -->
                <div class="border-t border-white/10 pt-4 mt-auto">
                    <div class="flex justify-between items-center mb-6">
                        <span class="text-lg font-bold text-brand-white">Total</span>
                        <span class="text-2xl font-black text-brand-gold">₹${o.total}</span>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="viewOrderDetails('${o.id}')" class="flex-1 py-2.5 bg-white/5 border border-white/10 text-brand-white rounded-xl text-xs font-bold hover:border-brand-gold hover:text-brand-gold transition-colors">See Details</button>
                        <button onclick="viewingOrderId='${o.id}';printOrderKOT()" class="px-3 py-2.5 bg-white/10 text-brand-white rounded-xl text-xs font-bold hover:bg-white hover:text-black transition-colors" title="Print KOT"><i data-lucide="printer" class="w-4 h-4"></i></button>
                        <button onclick="viewingOrderId='${o.id}';printOrderInvoice()" class="px-3 py-2.5 bg-brand-gold text-brand-black rounded-xl text-xs font-bold hover:bg-white transition-colors" title="Print Slip"><i data-lucide="printer" class="w-4 h-4"></i></button>
                        <select onchange="updateOrderStatus('${o.id}', this.value)" class="flex-1 bg-brand-gold/10 border border-brand-gold text-brand-gold rounded-xl px-2 py-2.5 text-xs font-bold focus:outline-none cursor-pointer text-center appearance-none">
                            ${o.orderType === 'pickup' ? `
                                <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                <option value="Accepted" ${o.status === 'Accepted' ? 'selected' : ''}>Accepted</option>
                                <option value="Cooking" ${o.status === 'Cooking' ? 'selected' : ''}>Cooking</option>
                                <option value="Ready to Collect" ${o.status === 'Ready to Collect' ? 'selected' : ''}>Ready to Collect</option>
                                <option value="Collected" ${o.status === 'Collected' ? 'selected' : ''}>Collected</option>
                                <option value="Rejected" ${o.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                            ` : `
                                <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                <option value="Accepted" ${o.status === 'Accepted' ? 'selected' : ''}>Accepted</option>
                                <option value="Cooking" ${o.status === 'Cooking' ? 'selected' : ''}>Cooking</option>
                                <option value="Ready for Delivery" ${o.status === 'Ready for Delivery' ? 'selected' : ''}>Ready for Delivery</option>
                                <option value="Out for Delivery" ${o.status === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
                                <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                                <option value="Rejected" ${o.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                            `}
                        </select>
                    </div>
                </div>
            </div>
        `;
    });
    if (window.lucide) lucide.createIcons();
}

window.renderAdminCustomers = function renderAdminCustomers() {
    const list = document.getElementById('admin-customers-list');
    if (!list) return;
    list.innerHTML = '';

    let displayUsers = [...allUsers];

    const searchInput = document.getElementById('customers-search');
    if (searchInput) {
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            displayUsers = displayUsers.filter(u => {
                return (u.name || '').toLowerCase().includes(query) ||
                    (u.email || '').toLowerCase().includes(query) ||
                    (u.phone || '').toLowerCase().includes(query);
            });
        }
    }

    const limitEl = document.getElementById('customers-limit');
    if (limitEl && limitEl.value !== 'all') {
        const limitInt = parseInt(limitEl.value);
        if (!isNaN(limitInt)) displayUsers = displayUsers.slice(0, limitInt);
    }

    if (displayUsers.length === 0) {
        list.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-sm text-brand-white/50 italic">No registered customers found.</td></tr>`;
        return;
    }

    displayUsers.forEach(user => {
        // Calculate order stats from allOrders
        const userOrders = allOrders.filter(o => o.userId === user.id);
        const completedOrders = userOrders.filter(o => ['Delivered', 'Collected'].includes(o.status));
        // Total spent includes all accepted/completed/cooking orders (anything not rejected/cancelled)
        const activeOrders = userOrders.filter(o => !['Rejected'].includes(o.status));
        const totalSpent = activeOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

        let firstOrderDate = user.customerSince || 'N/A';
        if (userOrders.length > 0) {
            const oldestOrder = userOrders[userOrders.length - 1];
            firstOrderDate = safeFormatDate(oldestOrder.timestamp, 'customer_date');
        }

        const walletBal = Number(user.walletBalance) || 0;
        const phone = user.phone || 'N/A';
        const email = user.email || 'N/A';
        const name = user.name || 'Anonymous';

        const tr = document.createElement('tr');
        tr.className = "hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 group";
        tr.innerHTML = `
            <td class="p-4">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-brand-gold/20 text-brand-gold flex items-center justify-center font-bold text-xs">
                        ${name.charAt(0).toUpperCase()}
                    </div>
                    <span class="font-bold text-brand-white text-sm group-hover:text-brand-gold transition-colors">${name}</span>
                </div>
            </td>
            <td class="p-4 text-sm text-brand-white/70">${email}</td>
            <td class="p-4 text-sm text-brand-white/70">${phone}</td>
            <td class="p-4 text-sm font-bold text-brand-white text-center">${completedOrders.length}</td>
            <td class="p-4 text-sm font-bold text-brand-gold text-center">₹${totalSpent}</td>
            <td class="p-4 text-sm font-bold text-brand-gold text-center">₹${walletBal}</td>
            <td class="p-4 text-sm text-brand-white/50 text-center">${firstOrderDate}</td>
            <td class="p-4 text-center">
                <button class="gift-cash-btn px-3 py-1.5 bg-brand-gold/20 hover:bg-brand-gold text-brand-gold hover:text-black border border-brand-gold/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1 mx-auto">
                    <i data-lucide="gift" class="w-3.5 h-3.5"></i> Gift Cash
                </button>
            </td>
        `;

        const giftBtn = tr.querySelector('.gift-cash-btn');
        if (giftBtn) {
            giftBtn.addEventListener('click', () => {
                window.openGiftWalletModal(user.id, name);
            });
        }

        list.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();

    // Also update the chat list since we have unique customers here
    renderAdminChatList();
}

// --- Messages Logic ---
let activeChatCustomerId = null;
let activeChatUnsubscribe = null;

function renderAdminChatList() {
    const chatList = document.getElementById('admin-chat-list');
    chatList.innerHTML = '';

    // 1. Get all active orders and recently completed orders (within 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeOrders = allOrders.filter(o => {
        if (!['Delivered', 'Collected', 'Rejected'].includes(o.status)) return true;
        const orderDate = new Date(o.timestamp);
        return orderDate >= sevenDaysAgo;
    });

    if (activeOrders.length === 0) {
        chatList.innerHTML = `<p class="text-brand-white/50 text-sm text-center py-8">No active orders available for chat.</p>`;
        return;
    }

    const chatOrders = activeOrders.map(order => {
        const orderMessages = allGlobalMessages.filter(m => m.orderId === order.id);
        const lastMessage = orderMessages.length > 0 ? orderMessages[orderMessages.length - 1] : null;

        let lastMessageTimestamp = new Date(order.timestamp).getTime();
        let hasUnread = false;

        if (lastMessage) {
            lastMessageTimestamp = new Date(lastMessage.timestamp).getTime();
            if (lastMessage.sender === 'Customer' && activeChatOrderId !== order.id && !readChats.has(order.id)) {
                hasUnread = true;
            }
        }

        return { ...order, lastMessage, lastMessageTimestamp, hasUnread };
    });

    chatOrders.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);

    chatOrders.forEach(order => {
        const dateStr = safeFormatDate(order.lastMessageTimestamp, 'time');
        const isActive = activeChatOrderId === order.id;
        const activeClasses = isActive ? 'bg-brand-gold/10 border-brand-gold/20' : 'hover:bg-white/5 border-transparent';

        let statusBadge = '';
        if (['Delivered', 'Collected', 'Rejected'].includes(order.status)) {
            let color = order.status === 'Rejected' ? 'text-red-500' : 'text-green-500';
            statusBadge = `<span class="${color} ml-1 uppercase text-[9px] font-black tracking-wider"> - ${order.status}</span>`;
        }

        const unreadDotHtml = order.hasUnread ? `<div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#111] rounded-full animate-pulse"></div>` : '';

        chatList.innerHTML += `
            <div data-order-id="${order.id}" onclick="openAdminChat('${order.id}', '${escapeHTML(order.customer).replace(/'/g, "\\'")}', '${order.userId}')" class="flex gap-4 p-4 rounded-2xl cursor-pointer transition-colors border hover:border-white/10 group ${activeClasses}">
                <div class="relative">
                    <div class="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-lg font-bold text-brand-white shrink-0 shadow-lg">
                        ${escapeHTML(order.customer).charAt(0).toUpperCase()}
                    </div>
                    ${unreadDotHtml}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start mb-1">
                        <h4 class="font-bold text-brand-white text-sm truncate">${escapeHTML(order.customer)} <span class="bg-brand-gold/20 text-brand-gold text-[10px] px-2 py-0.5 rounded ml-1">#${order.orderNumber ? String(order.orderNumber).padStart(5, '0') : order.id.substring(0, 6).toUpperCase()}</span>${statusBadge}</h4>
                        <span class="text-[10px] text-brand-white/40">${dateStr}</span>
                    </div>
                    <p class="text-xs ${order.hasUnread ? 'text-brand-white font-bold' : 'text-brand-white/50'} truncate group-hover:text-brand-white/80 transition-colors">${order.lastMessage ? escapeHTML(order.lastMessage.text) : 'Click to view messages...'}</p>
                </div>
            </div>
        `;
    });
}

let activeChatOrderId = null;

window.closeAdminChat = () => {
    activeChatOrderId = null;
    activeChatCustomerId = null;

    const chatListPane = document.getElementById('chat-list-pane');
    const chatWindowPane = document.getElementById('chat-window-pane');
    if (chatListPane && chatWindowPane) {
        if (window.innerWidth < 1024) {
            chatWindowPane.classList.add('hidden');
            chatWindowPane.classList.remove('flex');
            chatListPane.classList.remove('hidden');
            chatListPane.classList.add('flex');
        } else {
            chatListPane.classList.remove('hidden');
            chatListPane.classList.add('flex');
            chatWindowPane.classList.remove('hidden');
            chatWindowPane.classList.add('flex');
        }
    }

    // Clear highlight
    const chatItems = document.querySelectorAll('#admin-chat-list > div');
    chatItems.forEach(item => {
        item.classList.add('hover:bg-white/5', 'border-transparent');
        item.classList.remove('bg-brand-gold/10', 'border-brand-gold/20');
    });
};

window.openAdminChat = (orderId, customerName, customerId) => {
    activeChatOrderId = orderId;
    activeChatCustomerId = customerId;
    readChats.add(orderId);

    // Re-render to clear the unread dot instantly
    renderAdminChatList();

    // Toggle panes depending on screen width (desktop vs mobile responsive)
    const chatListPane = document.getElementById('chat-list-pane');
    const chatWindowPane = document.getElementById('chat-window-pane');
    if (chatListPane && chatWindowPane) {
        if (window.innerWidth < 1024) {
            chatListPane.classList.add('hidden');
            chatListPane.classList.remove('flex');
            chatWindowPane.classList.remove('hidden');
            chatWindowPane.classList.add('flex');
        } else {
            chatListPane.classList.remove('hidden');
            chatListPane.classList.add('flex');
            chatWindowPane.classList.remove('hidden');
            chatWindowPane.classList.add('flex');
        }
    }

    // Highlight the active chat item in the list
    const chatItems = document.querySelectorAll('#admin-chat-list > div');
    chatItems.forEach(item => {
        if (item.getAttribute('data-order-id') === orderId) {
            item.classList.remove('hover:bg-white/5', 'border-transparent');
            item.classList.add('bg-brand-gold/10', 'border-brand-gold/20');
        } else {
            item.classList.add('hover:bg-white/5', 'border-transparent');
            item.classList.remove('bg-brand-gold/10', 'border-brand-gold/20');
        }
    });

    const orderObj = allOrders.find(ord => ord.id === orderId);
    const formattedOrderId = orderObj && orderObj.orderNumber ? String(orderObj.orderNumber).padStart(5, '0') : orderId.substring(0, 6).toUpperCase();

    document.getElementById('chat-header-avatar').innerText = customerName.charAt(0).toUpperCase();
    document.getElementById('chat-header-name').innerText = `${customerName} (Order #${formattedOrderId})`;
    document.getElementById('chat-header-actions').classList.remove('hidden');
    document.getElementById('chat-input-form').classList.remove('hidden');

    const messagesContainer = document.getElementById('chat-messages-container');
    messagesContainer.innerHTML = `
        <div class="flex justify-center my-4">
            <span class="px-3 py-1 bg-white/5 rounded-full text-xs text-brand-white/40 border border-white/10">Loading chat history...</span>
        </div>
    `;

    if (activeChatUnsubscribe) activeChatUnsubscribe();

    activeChatUnsubscribe = onSnapshot(collection(db, "messages"), (snap) => {
        let msgs = [];
        snap.forEach(doc => {
            const data = doc.data();
            if (data.orderId === activeChatOrderId) {
                msgs.push({ id: doc.id, ...data });
            }
        });

        msgs.sort((a, b) => (new Date(a.timestamp || 0)) - (new Date(b.timestamp || 0)));

        if (msgs.length === 0) {
            messagesContainer.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center text-brand-white/30 text-sm">
                    <i data-lucide="message-square" class="w-12 h-12 mb-4 opacity-50"></i>
                    No messages yet. Send a message to start!
                </div>
            `;
            if (window.lucide) lucide.createIcons();
            return;
        }

        messagesContainer.innerHTML = '';
        msgs.forEach(m => {
            const timeStr = safeFormatDate(m.timestamp, 'time');
            const isAdmin = m.sender === 'Admin';

            if (isAdmin) {
                messagesContainer.innerHTML += `
                    <div class="flex justify-end mb-4">
                        <div class="max-w-[70%]">
                            <div class="bg-brand-gold text-black px-4 py-3 rounded-2xl rounded-tr-none text-sm mb-1 shadow-[0_4px_15px_rgba(212, 160, 23,0.15)]">
                                ${m.text}
                            </div>
                            <div class="flex justify-end items-center gap-1 text-[10px] text-brand-white/40">
                                ${timeStr} <i data-lucide="check-check" class="w-3 h-3 text-brand-gold"></i>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                messagesContainer.innerHTML += `
                    <div class="flex items-end gap-2 mb-4">
                        <div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-brand-white text-xs flex-shrink-0">
                            ${customerName.charAt(0).toUpperCase()}
                        </div>
                        <div class="max-w-[70%]">
                            <div class="bg-white/10 border border-white/5 text-brand-white px-4 py-3 rounded-2xl rounded-tl-none text-sm mb-1">
                                ${m.text}
                            </div>
                            <div class="text-[10px] text-brand-white/40 ml-1">
                                ${timeStr}
                            </div>
                        </div>
                    </div>
                `;
            }
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (window.lucide) lucide.createIcons();
    });
};

document.getElementById('chat-input-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input-text');
    const text = input.value.trim();
    if (!text || !activeChatOrderId) return;

    input.value = '';
    await addDoc(collection(db, "messages"), {
        customerId: activeChatCustomerId,
        orderId: activeChatOrderId,
        sender: 'Admin',
        text: text,
        timestamp: new Date().toISOString()
    });

    // Send push notification to the customer
    try {
        const userDoc = await getDoc(doc(db, "users", activeChatCustomerId));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.fcmToken) {
                const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
                const pushUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/send-push' : '/api/send-push';
                fetch(pushUrl, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({
                        token: userData.fcmToken,
                        title: "Message from Didi's Biryani Support",
                        body: text,
                        data: { orderId: activeChatOrderId, type: 'chat' }
                    })
                }).catch(err => console.error("Push Notification Error (Chat):", err));
            }
        }
    } catch(err) {
        console.error("Error fetching user token for chat push:", err);
    }
});

// --- Detailed Order View ---
window.sendWhatsAppPaymentLink = (orderId, amount, phone) => {
    const paymentUrl = `https://didisbiryani.in/payment.html?orderId=${orderId}`;
    const text = `Hi! Please pay ₹${amount} for your order from Didi's Biryani using this secure link: \n\n${paymentUrl}`;
    
    // Extract numbers only
    let formattedPhone = phone ? String(phone).replace(/\D/g, '') : '';
    if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

    if (formattedPhone) {
        window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
};

window.viewOrderDetails = (id) => {
    const o = allOrders.find(ord => ord.id === id);
    if (!o) return;

    // Header
    document.getElementById('detail-order-id').innerText = `Order #${o.orderNumber ? String(o.orderNumber).padStart(5, '0') : o.id.substring(0, 8).toUpperCase()}`;
    document.getElementById('detail-date').innerText = safeFormatDate(o.timestamp, 'datetime');
    document.getElementById('detail-count').innerText = `${o.items ? o.items.length : 0} Products`;

    // Customer
    document.getElementById('detail-cust-name').innerText = o.customer;
    document.getElementById('detail-cust-address').innerText = o.address;
    document.getElementById('detail-cust-email').innerText = o.email || 'N/A';
    document.getElementById('detail-cust-phone').innerText = o.phone || 'N/A';
    document.getElementById('detail-notes').innerText = o.notes || 'No special instructions provided.';

    // Totals
    const subtotal = (o.items || []).reduce((s, i) => s + (Number(i.price) * Number(i.quantity)), 0);
    document.getElementById('detail-subtotal').innerText = `₹${subtotal}`;
    document.getElementById('detail-discount').innerText = `-₹${o.discount || 0}`;
    document.getElementById('detail-delivery').innerText = `₹${o.deliveryCharge !== undefined ? o.deliveryCharge : 0}`;
    document.getElementById('detail-tax').innerText = `₹${o.taxAmount || 0}`;

    const tipRow = document.getElementById('detail-tip-row');
    const actualTip = Number(o.donationAmount) || Number(o.tipAmount) || 0;
    if (actualTip > 0) {
        tipRow.classList.remove('hidden');
        tipRow.classList.add('flex');
        document.getElementById('detail-tip').innerText = `₹${actualTip.toFixed(2)}`;
    } else {
        tipRow.classList.add('hidden');
        tipRow.classList.remove('flex');
    }

    document.getElementById('detail-total').innerText = `₹${o.total}`;

    // Logistics & Tx
    document.getElementById('detail-pay-mode').innerText = (o.paymentMethod || 'Online').toUpperCase();
    document.getElementById('detail-delivery-id').innerText = `ID: DLY-${o.id.substring(0, 6).toUpperCase()}`;
    const txTime = o.timestamp ? new Date(o.timestamp).getTime() : null;
    document.getElementById('detail-tx-id').innerText = `TX-${txTime && !isNaN(txTime) ? txTime : 'N/A'}`;
    document.getElementById('detail-tx-method').innerText = o.paymentMethod || 'Online';
    document.getElementById('detail-tx-status').innerText = o.status;
    document.getElementById('detail-tx-status').innerText = o.status;

    // WhatsApp Payment Link Button Logic
    const waPayContainer = document.getElementById('wa-pay-container');
    const whatsappBtn = document.getElementById('btn-admin-whatsapp-pay');
    const waPhoneInput = document.getElementById('admin-custom-wa-phone');
    if (waPayContainer && whatsappBtn && waPhoneInput) {
        if (o.status !== 'Delivered' && o.status !== 'Collected' && o.status !== 'Rejected' && 
            o.paymentMethod !== 'Online (Razorpay)' && o.paymentMethod !== 'Direct UPI' &&
            String(o.paymentMethod || '').toLowerCase() !== 'online' && !String(o.paymentMethod || '').toLowerCase().includes('razorpay')) {
            
            waPayContainer.classList.remove('hidden');
            waPhoneInput.value = o.phone || '';
            const dueAmt = o.amountDue !== undefined ? o.amountDue : o.total;
            whatsappBtn.onclick = () => sendWhatsAppPaymentLink(o.id, dueAmt, waPhoneInput.value);
        } else {
            waPayContainer.classList.add('hidden');
        }
    }

    // Delivery Boy Assignment Dropdown
    const assignSelect = document.getElementById('assign-delivery-boy-select');
    assignSelect.innerHTML = '<option value="">-- Assign Driver --</option>';
    allDeliveryBoys.forEach(boy => {
        const isSelected = o.deliveryBoyId === boy.id ? 'selected' : '';
        assignSelect.innerHTML += `<option value="${boy.id}" ${isSelected}>${boy.name} (${boy.phone})</option>`;
    });

    viewingOrderId = id;

    // Progress Bar
    renderOrderProgress(o.status, o.orderType);

    // Items List
    const itemsList = document.getElementById('detail-items-list');
    itemsList.innerHTML = '';
    (o.items || []).forEach(i => {
        const itemTotal = i.price * i.quantity;
        
        let addonHtml = '';
        if (i.addonDetails && i.addonDetails.length > 0) {
            addonHtml = `<div class="mt-2 flex flex-wrap gap-2">`;
            i.addonDetails.forEach(ad => {
                addonHtml += `
                    <div class="flex items-center gap-2 bg-brand-gold/20 border border-brand-gold/50 rounded-md px-2.5 py-1 w-max">
                        <span class="text-xs font-black text-brand-gold tracking-wide">${ad.name}</span>
                        <span class="text-[10px] font-black text-brand-white bg-black/60 px-1.5 py-0.5 rounded shadow-inner">₹${ad.price}</span>
                    </div>
                `;
            });
            addonHtml += `</div>`;
        } else if (i.customizations && Object.keys(i.customizations).length > 0) {
            const custStr = Object.values(i.customizations).join(', ');
            addonHtml = `<div class="mt-2 bg-brand-gold/20 border border-brand-gold/50 rounded-md px-2.5 py-1 w-max">
                <span class="text-xs font-black text-brand-gold tracking-wide">${custStr}</span>
            </div>`;
        }

        itemsList.innerHTML += `
            <div class="flex flex-col sm:grid sm:grid-cols-12 gap-4 p-4 items-center">
                <div class="sm:col-span-6 flex items-center gap-4 w-full">
                    <div class="w-12 h-12 rounded-lg bg-black/50 overflow-hidden border border-white/10 flex-shrink-0">
                        <img src="${i.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=150'}" class="w-full h-full object-cover">
                    </div>
                    <div>
                        <h4 class="font-bold text-brand-white text-sm">${i.name}${i.variantLabel ? ` <span class="text-brand-gold font-normal text-xs">— ${i.variantLabel}</span>` : ''}</h4>
                        ${i.quantityLabel ? `<p class="text-[10px] text-brand-gold/70 font-bold mt-0.5">${i.quantityLabel}</p>` : ''}
                        ${addonHtml}
                    </div>
                </div>
                <div class="sm:col-span-2 text-center text-sm text-brand-white/70 w-full">₹${i.price}</div>
                <div class="sm:col-span-2 text-center text-sm font-bold text-brand-white w-full">x${i.quantity}</div>
                <div class="sm:col-span-2 text-right font-bold text-brand-gold w-full">₹${itemTotal}</div>
            </div>
        `;
    });

    // --- SECURITY: Price Tampering Check ---
    let expectedTotal = 0;
    (o.items || []).forEach(i => {
        const realItem = allMenu.find(m => m.id === i.id);
        if (realItem) {
            let basePrice = Number(realItem.price);
            if (i.variantLabel && realItem.variants) {
                const v = realItem.variants.find(v => v.label === i.variantLabel);
                if (v && v.price !== undefined) {
                    basePrice = Number(v.price);
                }
            }
            
            let addonsPrice = 0;
            if (i.addonDetails && i.addonDetails.length > 0) {
                i.addonDetails.forEach(ad => addonsPrice += Number(ad.price));
            }
            
            expectedTotal += (basePrice + addonsPrice) * Number(i.quantity);
        } else {
            expectedTotal += Number(i.price) * Number(i.quantity);
        }
    });
    expectedTotal += Number(o.deliveryCharge || 0);
    expectedTotal += Number(o.taxAmount || 0);
    expectedTotal -= Number(o.discount || 0);
    expectedTotal += Number(o.tipAmount || 0);
    expectedTotal += Number(o.donationAmount || 0);

    const existingWarning = document.getElementById('price-tamper-warning');
    if (existingWarning) existingWarning.remove();

    if (Math.abs(Number(o.total) - expectedTotal) > 5) {
        const warningHtml = `<div id="price-tamper-warning" class="bg-red-500 text-white font-bold p-3 text-sm rounded-xl mt-4 mb-4 flex items-center gap-2 animate-pulse"><i data-lucide="alert-triangle" class="w-5 h-5"></i> SECURITY WARNING: PRICE TAMPERING DETECTED! Expected approx ₹${expectedTotal.toFixed(2)} but customer paid ₹${Number(o.total).toFixed(2)}</div>`;
        itemsList.insertAdjacentHTML('beforebegin', warningHtml);
    }
    // Review Section
    const reviewSection = document.getElementById('detail-review-section');
    if (reviewSection) {
        if (o.review) {
            reviewSection.classList.remove('hidden');

            const starsContainer = document.getElementById('detail-review-stars');
            if (starsContainer) {
                starsContainer.innerHTML = Array(5).fill(0).map((_, i) =>
                    `<i data-lucide="star" class="w-4 h-4 ${i < o.review.rating ? 'fill-brand-gold text-brand-gold' : 'text-white/20'}"></i>`
                ).join('');
            }

            const textEl = document.getElementById('detail-review-text');
            if (textEl) textEl.innerText = o.review.text ? `"${o.review.text}"` : 'No comment provided.';

            const dateEl = document.getElementById('detail-review-date');
            if (dateEl) dateEl.innerText = safeFormatDate(o.review.timestamp, 'datetime');
        } else {
            reviewSection.classList.add('hidden');
        }
    }

    switchTab('order-details');
    if (window.lucide) lucide.createIcons();
};

window.assignDeliveryBoy = async (driverId) => {
    if (!viewingOrderId) return;
    try {
        await updateDoc(doc(db, "orders", viewingOrderId), {
            deliveryBoyId: driverId || null
        });
        // We don't need to re-render everything, the onSnapshot will catch it
        // but maybe alert for confirmation
    } catch (e) {
        console.error("Error assigning driver", e);
        alert("Failed to assign driver. Check permissions.");
    }
};

function renderOrderProgress(status, orderType) {
    const isPickup = orderType === 'pickup';
    const states = isPickup ?
        ['Pending', 'Accepted', 'Cooking', 'Ready to Collect', 'Collected'] :
        ['Pending', 'Accepted', 'Cooking', 'Ready for Delivery', 'Out for Delivery', 'Delivered'];

    let currentIndex = states.indexOf(status);
    if (currentIndex === -1) currentIndex = 0;

    const bar = document.getElementById('detail-progress-bar');
    bar.innerHTML = '';

    states.forEach((state, i) => {
        const isActive = i <= currentIndex;
        const isCurrent = i === currentIndex;

        let circleClass = isActive ? 'bg-brand-gold text-black border-brand-gold' : 'bg-white/5 text-brand-white/30 border-white/10';
        let iconHtml = isActive && !isCurrent ? '<i data-lucide="check" class="w-4 h-4"></i>' : `0${i + 1}`;

        bar.innerHTML += `
            <div class="flex flex-col items-center gap-2">
                <div class="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold ${circleClass} shadow-lg z-10 transition-colors duration-500">
                    ${iconHtml}
                </div>
                <span class="text-[10px] font-bold ${isActive ? 'text-brand-gold' : 'text-brand-white/30'} uppercase tracking-wider">${state}</span>
            </div>
        `;
    });

    // Update fill line
    const fillPercent = (currentIndex / (states.length - 1)) * 100;
    document.getElementById('detail-progress-fill').style.width = `${fillPercent}%`;
    if (window.lucide) lucide.createIcons();
}

// --- Listeners ---
onSnapshot(menuCol, (snap) => {
    allMenu = [];
    snap.forEach(doc => allMenu.push({ id: doc.id, ...doc.data() }));
    populateCategoryDropdown();
    renderAdminMenu();
    renderDashboardHome();
    renderSfCategories();

    const targetSelect = document.getElementById('couponTargetItemId');
    if (targetSelect) {
        targetSelect.innerHTML = allMenu.map(m => `<option value="${m.id}">${m.name} (₹${m.price})</option>`).join('');
    }

    const catSelect = document.getElementById('bannerCategoryLink');
    const dishSelect = document.getElementById('bannerDishLink');
    if (catSelect && dishSelect) {
        const categories = new Set(['Biryani', 'Thali', 'Momo']);
        allMenu.forEach(item => {
            if (item.category) categories.add(item.category);
        });
        catSelect.innerHTML = Array.from(categories).map(cat => `<option value="${cat}">${cat}</option>`).join('');
        dishSelect.innerHTML = allMenu.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    }
});

let previousOrderCount = -1;
const notificationSound = new Audio('/cash-register.mp3');

// To prevent infinite order loading (which crashes the dashboard as order count grows),
// we only fetch orders from the last 30 days by default.
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const recentOrdersQuery = query(ordersCol, where("timestamp", ">=", thirtyDaysAgo.toISOString()));

onSnapshot(recentOrdersQuery, (snap) => {
    allOrders = [];
    snap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));

    // Play audio notification if a new order arrives
    if (previousOrderCount !== -1 && allOrders.length > previousOrderCount) {
        notificationSound.play().catch(e => console.log("Audio autoplay prevented by browser", e));
    }
    previousOrderCount = allOrders.length;

    // Check for any manual orders that got paid via a cached payment.js and fix them automatically
    allOrders.forEach(o => {
        if (o.isManual && o.status === 'Pending' && o.paymentMethod === 'Online (Razorpay)' && o.paymentStatus !== 'Paid') {
            updateDoc(doc(db, "orders", o.id), {
                status: 'Accepted',
                paymentStatus: 'Paid'
            }).catch(e => console.error("Auto-accept fallback failed:", e));
        }
    });

    // Sort orders by timestamp descending (newest first)
    allOrders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    renderAdminOrders();
    renderAdminCustomers();
    renderDashboardHome();
    renderAdminWallet();
    if (window.renderOrderHistory) window.renderOrderHistory();
});

// --- Delivery Boys Management ---
const deliveryBoysCol = collection(db, "deliveryBoys");

onSnapshot(deliveryBoysCol, (snapshot) => {
    allDeliveryBoys = [];
    snapshot.forEach(doc => {
        allDeliveryBoys.push({ id: doc.id, ...doc.data() });
    });
    renderDeliveryBoys();
    renderAdminOrders(); // Re-render orders in case we need to update the dropdowns
    renderAdminWallet();
});

// --- Customers / Users Management ---
const usersCol = collection(db, "users");

onSnapshot(usersCol, (snapshot) => {
    allUsers = [];
    snapshot.forEach(docSnap => {
        allUsers.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderAdminCustomers();
});

document.getElementById('add-delivery-boy-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        name: document.getElementById('driverName').value.trim(),
        phone: document.getElementById('driverPhone').value.trim(),
        passcode: document.getElementById('driverPasscode').value.trim(),
        createdAt: new Date().toISOString()
    };
    await addDoc(deliveryBoysCol, data);
    document.getElementById('add-delivery-boy-form').reset();
});

window.deleteDeliveryBoy = async (id) => {
    if (confirm("Are you sure you want to remove this delivery boy?")) {
        await deleteDoc(doc(db, "deliveryBoys", id));
    }
};

window.renderDeliveryBoys = () => {
    const list = document.getElementById('delivery-boys-list');
    if (!list) return;

    list.innerHTML = '';

    if (allDeliveryBoys.length === 0) {
        list.innerHTML = `<p class="text-brand-white/50 italic">No delivery boys added yet.</p>`;
        return;
    }

    allDeliveryBoys.forEach(boy => {
        const driverStatus = boy.status || 'Offline';
        let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white/50">OFFLINE</span>`;
        if (driverStatus === 'Available') statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-500">AVAILABLE</span>`;
        if (driverStatus === 'On Delivery') statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-500">ON DELIVERY</span>`;

        list.innerHTML += `
            <div class="glass border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 group hover:border-brand-gold/30 transition-colors">
                <div class="flex items-center gap-3 sm:gap-4">
                    <div class="w-12 h-12 bg-black/50 rounded-full flex items-center justify-center text-brand-gold border border-brand-gold/20 flex-shrink-0">
                        <i data-lucide="user" class="w-6 h-6"></i>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <h4 class="font-bold text-brand-white text-base sm:text-lg leading-none truncate max-w-[120px] xs:max-w-none">${boy.name}</h4>
                            ${statusBadge}
                        </div>
                        <p class="text-xs text-brand-white/50 mt-0.5">Phone: <a href="tel:${boy.phone}" class="hover:text-brand-gold">${boy.phone}</a> | PIN: ${boy.passcode}</p>
                    </div>
                </div>
                <button onclick="deleteDeliveryBoy('${boy.id}')" class="w-full sm:w-10 h-10 flex items-center justify-center bg-black/50 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors border border-red-500/30 py-2.5 sm:py-0" title="Remove Driver">
                    <i data-lucide="trash-2" class="w-4 h-4 mr-2 sm:mr-0"></i><span class="sm:hidden text-xs font-bold">Remove Driver</span>
                </button>
            </div>
        `;
    });
    if (window.lucide) lucide.createIcons();
}

// --- Wallet Logic ---
window.renderAdminWallet = function () {
    const totalRevEl = document.getElementById('wallet-total-revenue');
    const todayRevEl = document.getElementById('wallet-today-revenue');
    const onlineRevEl = document.getElementById('wallet-online-revenue');
    const codRevEl = document.getElementById('wallet-cod-revenue');
    const todayCountEl = document.getElementById('wallet-today-count');
    const rejectedAmountEl = document.getElementById('wallet-rejected-amount');
    const rejectedCountEl = document.getElementById('wallet-rejected-count');
    const deliveryTable = document.getElementById('wallet-delivery-table');
    const statementTable = document.getElementById('wallet-statement-table');
    const targetDateInput = document.getElementById('wallet-target-date');

    if (!totalRevEl) return;

    if (targetDateInput && !targetDateInput.hasAttribute('data-initialized')) {
        const localToday = new Date().toLocaleDateString('en-CA');
        targetDateInput.value = localToday;
        targetDateInput.setAttribute('data-initialized', 'true');
    }

    const targetDateStr = targetDateInput ? targetDateInput.value : null;

    let filterStart = null;
    let filterEnd = null;
    if (targetDateStr) {
        filterStart = new Date(targetDateStr);
        filterStart.setHours(0, 0, 0, 0);
        filterEnd = new Date(targetDateStr);
        filterEnd.setHours(23, 59, 59, 999);
    }

    let totalRevenue = 0;
    let onlineRevenue = 0;
    let codRevenue = 0;
    let ordersCount = 0;
    let rejectedAmount = 0;
    let rejectedCount = 0;
    let rejectedOrdersList = [];

    const deliveryStats = {}; // driverId -> { deliveries: 0, tips: 0, cashCollected: 0 }
    const dailyStats = {}; // YYYY-MM-DD -> { orders: 0, online: 0, cod: 0, total: 0 }

    allDeliveryBoys.forEach(boy => {
        deliveryStats[boy.id] = { name: boy.name, deliveries: 0, tips: 0, cashCollected: 0 };
    });

    allOrders.forEach(o => {
        const orderDate = new Date(o.timestamp);
        const total = Number(o.total) || 0;
        const tip = Number(o.donationAmount) || Number(o.tipAmount) || 0;

        // Apply Date Filter
        if (filterStart && orderDate < filterStart) return;
        if (filterEnd && orderDate > filterEnd) return;

        const dateStr = orderDate.toLocaleDateString('en-CA');

        if (!dailyStats[dateStr]) {
            dailyStats[dateStr] = { orders: 0, online: 0, cod: 0, total: 0 };
        }

        if (o.status === 'Rejected') {
            rejectedAmount += total;
            rejectedCount++;
            rejectedOrdersList.push(o);
        } else if (['Delivered', 'Collected', 'Accepted', 'Cooking', 'Ready for Delivery', 'Ready to Collect', 'Out for Delivery'].includes(o.status)) {
            totalRevenue += total;
            ordersCount++;

            dailyStats[dateStr].total += total;
            dailyStats[dateStr].orders++;

            if (o.paymentMethod === 'upi' || o.paymentMethod === 'card' || o.paymentMethod === 'online' || String(o.paymentMethod).toLowerCase().includes('razorpay') || String(o.paymentMethod).toLowerCase().includes('online')) {
                onlineRevenue += total;
                dailyStats[dateStr].online += total;
            } else if (String(o.paymentMethod).toLowerCase().includes('cod') || String(o.paymentMethod).toLowerCase().includes('cash')) {
                codRevenue += total;
                dailyStats[dateStr].cod += total;
            }

            // Driver stats
            if (o.deliveryBoyId && deliveryStats[o.deliveryBoyId]) {
                if (['Delivered', 'Out for Delivery'].includes(o.status)) {
                    deliveryStats[o.deliveryBoyId].deliveries++;
                    deliveryStats[o.deliveryBoyId].tips += tip;

                    if (String(o.paymentMethod).toLowerCase().includes('cod') || String(o.paymentMethod).toLowerCase().includes('cash')) {
                        const due = o.amountDue !== undefined ? Number(o.amountDue) : total;
                        deliveryStats[o.deliveryBoyId].cashCollected += due;
                    }
                }
            }
        }
    });

    totalRevEl.innerText = `₹${totalRevenue}`;
    if (todayRevEl) todayRevEl.innerText = `₹${totalRevenue}`; // Duplicate for UI layout
    onlineRevEl.innerText = `₹${onlineRevenue}`;
    codRevEl.innerText = `₹${codRevenue}`;
    if (todayCountEl) todayCountEl.innerText = ordersCount;
    rejectedAmountEl.innerText = `₹${rejectedAmount}`;
    rejectedCountEl.innerText = rejectedCount;

    // Render delivery table
    if (deliveryTable) {
        deliveryTable.innerHTML = '';
        const drivers = Object.values(deliveryStats).sort((a, b) => b.deliveries - a.deliveries);
        if (drivers.length === 0) {
            deliveryTable.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-sm text-brand-white/50">No delivery boys found.</td></tr>`;
        } else {
            drivers.forEach(d => {
                deliveryTable.innerHTML += `
                    <tr>
                        <td class="py-4 text-sm font-bold text-brand-white">${d.name}</td>
                        <td class="py-4 text-sm text-brand-white/80">${d.deliveries}</td>
                        <td class="py-4 text-sm font-bold text-brand-gold text-right">₹${d.tips}</td>
                        <td class="py-4 text-sm font-bold text-green-500 text-right">₹${d.cashCollected}</td>
                    </tr>
                `;
            });
        }
    }

    // Render daily statement table
    if (statementTable) {
        statementTable.innerHTML = '';
        const sortedDates = Object.keys(dailyStats).sort((a, b) => new Date(b) - new Date(a));

        if (sortedDates.length === 0) {
            statementTable.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-sm text-brand-white/50">No revenue data for the selected period.</td></tr>`;
        } else {
            sortedDates.forEach(date => {
                const stat = dailyStats[date];
                const displayDate = safeFormatDate(date, 'statement_date');

                statementTable.innerHTML += `
                    <tr class="hover:bg-white/5 transition-colors group">
                        <td class="py-4 pl-2 text-sm font-bold text-brand-white">${displayDate}</td>
                        <td class="py-4 text-sm text-center text-brand-white/80"><span class="bg-white/10 px-2 py-0.5 rounded-md">${stat.orders}</span></td>
                        <td class="py-4 text-sm font-medium text-brand-white/90 text-right">₹${stat.online}</td>
                        <td class="py-4 text-sm font-medium text-brand-white/90 text-right">₹${stat.cod}</td>
                        <td class="py-4 pr-2 text-sm font-black text-brand-gold text-right group-hover:scale-105 transition-transform origin-right">₹${stat.total}</td>
                    </tr>
                `;
            });
        }
    }

    // Populate Rejected Orders Modal Table
    const rejectedTable = document.getElementById('rejected-orders-table');
    if (rejectedTable) {
        rejectedTable.innerHTML = '';
        if (rejectedOrdersList.length === 0) {
            rejectedTable.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-sm text-brand-white/50">No rejected orders found for this period.</td></tr>`;
        } else {
            rejectedOrdersList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            rejectedOrdersList.forEach(o => {
                const dateStr = safeFormatDate(o.timestamp, 'datetime');
                const orderNum = o.orderNumber ? String(o.orderNumber).padStart(5, '0') : o.id.substring(0, 6).toUpperCase();
                const pm = o.paymentMethod || 'Unknown';
                const pid = o.paymentId || 'N/A';

                rejectedTable.innerHTML += `
                    <tr class="hover:bg-white/5 transition-colors">
                        <td class="p-4 text-xs text-brand-white/80">${dateStr}</td>
                        <td class="p-4">
                            <div class="text-sm font-bold text-brand-white">${o.customer || 'Unknown'}</div>
                            <div class="text-xs text-brand-white/50">${o.phone || 'No phone'}</div>
                        </td>
                        <td class="p-4 text-sm font-bold text-brand-gold">#${orderNum}</td>
                        <td class="p-4">
                            <div class="text-xs text-brand-white/80">${pm}</div>
                            <div class="text-[10px] text-brand-white/50 font-mono select-all">${pid}</div>
                        </td>
                        <td class="p-4 text-sm font-black text-red-500 text-right">₹${o.total || 0}</td>
                    </tr>
                `;
            });
        }
    }
}

window.showModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.setProperty('display', 'flex', 'important');
    }
};

window.hideModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        modal.style.setProperty('display', 'none', 'important');
    }
};

window.openRejectedOrdersModal = () => {
    window.showModal('rejected-orders-modal');
};

// ==========================================
// COUPON MANAGEMENT LOGIC
// ==========================================
const couponsCol = collection(db, "coupons");

document.getElementById('create-coupon-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('couponCode').value.toUpperCase().trim();
    const audience = document.getElementById('couponAudience').value;
    const targetType = document.getElementById('couponTargetType').value;
    const targetItemId = targetType === 'specific_item' ? document.getElementById('couponTargetItemId').value : null;
    const type = document.getElementById('couponType').value;
    const value = (type === 'bogo' || type === 'free_delivery') ? 0 : Number(document.getElementById('couponValue').value);
    const minOrder = Number(document.getElementById('couponMinOrder').value);

    try {
        await addDoc(couponsCol, {
            code, type, value, minOrder,
            targetAudience: audience,
            targetType: targetType,
            targetItemId: targetItemId,
            isActive: true,
            createdAt: new Date().toISOString()
        });
        showToast('Coupon created successfully!', 'success');
        e.target.reset();
        document.getElementById('specific-dish-container').classList.add('hidden');
        document.getElementById('coupon-value-container').classList.remove('hidden');
    } catch (err) {
        console.error("Error creating coupon:", err);
        showToast("Failed to create coupon.", 'error');
    }
});

onSnapshot(couponsCol, (snapshot) => {
    const tbody = document.getElementById('coupons-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (snapshot.empty) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-sm text-brand-white/50">No coupons found.</td></tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const c = docSnap.data();
        const id = docSnap.id;
        const statusBadge = c.isActive
            ? `<span class="px-2 py-1 bg-green-500/20 text-green-500 rounded text-xs font-bold">Active</span>`
            : `<span class="px-2 py-1 bg-red-500/20 text-brand-red rounded text-xs font-bold">Inactive</span>`;

        let discountText = c.type === 'percent' ? `${c.value}% OFF` : (c.type === 'fixed' ? `₹${c.value} OFF` : (c.type === 'free_delivery' ? 'Free Delivery' : `BOGO`));
        if (c.targetType === 'specific_item') {
            const m = allMenu.find(item => item.id === c.targetItemId);
            discountText += `<br><span class="text-[10px] text-brand-white/50">Only on: ${m ? m.name : 'Unknown Item'}</span>`;
        }
        if (c.targetAudience === 'new_users') {
            discountText += `<br><span class="text-[10px] text-brand-gold">New Users Only</span>`;
        }

        tbody.innerHTML += `
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td class="py-4 text-sm font-bold text-brand-gold uppercase pl-2">${c.code}</td>
                <td class="py-4 text-sm font-bold text-brand-white leading-tight">${discountText}</td>
                <td class="py-4 text-sm text-brand-white/80">₹${c.minOrder}</td>
                <td class="py-4 text-center">${statusBadge}</td>
                <td class="py-4 text-right pr-2">
                    <button onclick="toggleCoupon('${id}', ${c.isActive})" class="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs text-brand-white transition-colors mr-2">Toggle</button>
                    <button onclick="deleteCoupon('${id}')" class="px-3 py-1 bg-brand-red/20 text-brand-red hover:bg-brand-red hover:text-white rounded text-xs transition-colors">Delete</button>
                </td>
            </tr>
        `;
    });
});

window.toggleCoupon = async (id, currentStatus) => {
    await updateDoc(doc(db, "coupons", id), { isActive: !currentStatus });
};

window.deleteCoupon = async (id) => {
    if (confirm("Are you sure you want to delete this coupon?")) {
        await deleteDoc(doc(db, "coupons", id));
    }
};

// ==========================================
// STOREFRONT CMS LOGIC
// ==========================================
let sfCategories = [];

async function loadStorefrontSettings() {
    try {
        const docSnap = await getDoc(doc(db, "settings", "storefront"));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.heroBanner) {
                const imgEl = document.getElementById('sf-hero-image');
                const titleEl = document.getElementById('sf-hero-title');
                const subtitleEl = document.getElementById('sf-hero-subtitle');
                const btnEl = document.getElementById('sf-hero-btn');

                if (imgEl) imgEl.value = data.heroBanner.image || '';
                if (titleEl) titleEl.value = data.heroBanner.title || '';
                if (subtitleEl) subtitleEl.value = data.heroBanner.subtitle || '';
                if (btnEl) btnEl.value = data.heroBanner.buttonText || '';
            }
            if (data.categories) {
                sfCategories = data.categories;
            }
        } else {
            // Default categories if nothing exists
            sfCategories = [
                { name: "Biryani", image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=300" },
                { name: "Thali", image: "https://images.unsplash.com/photo-1626776876729-bab4369a5a5a?q=80&w=300" }
            ];
        }
        renderSfCategories();
    } catch (e) {
        console.error("Error loading storefront:", e);
    }
}

function renderSfCategories() {
    const container = document.getElementById('sf-categories-container');
    if (!container) return;

    // Core categories + any unique categories from the current menu database
    const categories = new Set(['Biryani', 'Thali', 'Momo']);
    allMenu.forEach(item => {
        if (item.category) {
            categories.add(item.category);
        }
    });

    container.innerHTML = '';
    sfCategories.forEach((cat, index) => {
        // If the category name doesn't match any option in unique list, or if it is empty, treat as custom.
        const isCustom = cat.name && !categories.has(cat.name);

        let optionsHtml = '';
        categories.forEach(c => {
            const isSelected = !isCustom && cat.name === c;
            optionsHtml += `<option value="${c}" ${isSelected ? 'selected' : ''}>${c}</option>`;
        });

        container.innerHTML += `
            <div class="flex flex-col md:flex-row gap-4 items-center bg-white/5 p-4 rounded-xl border border-white/10">
                <div class="flex-1 w-full">
                    <label class="block text-[10px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Link Category</label>
                    <select onchange="window.handleSfCategorySelectChange(${index}, this.value)" class="w-full bg-black/50 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-gold">
                        ${optionsHtml}
                        <option value="__custom__" ${isCustom || !cat.name ? 'selected' : ''}>+ Add Custom Category...</option>
                    </select>
                    
                    <div id="custom-cat-input-container-${index}" class="mt-2 ${isCustom || !cat.name ? '' : 'hidden'}">
                        <input type="text" id="custom-cat-input-${index}" placeholder="Enter custom category name" value="${cat.name || ''}" oninput="window.updateSfCategory(${index}, 'name', this.value)" class="w-full bg-black/50 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-gold">
                    </div>
                </div>
                <div class="flex-1 w-full">
                    <label class="block text-[10px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Image URL</label>
                    <input type="text" value="${cat.image || ''}" onchange="window.updateSfCategory(${index}, 'image', this.value)" class="w-full bg-black/50 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-gold">
                </div>
                <button onclick="removeSfCategory(${index})" class="mt-4 md:mt-0 p-2 text-brand-red/50 hover:text-brand-red transition-colors">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            </div>
        `;
    });
    if (window.lucide) lucide.createIcons();
}

window.handleSfCategorySelectChange = (index, value) => {
    const customContainer = document.getElementById(`custom-cat-input-container-${index}`);
    const customInput = document.getElementById(`custom-cat-input-${index}`);

    if (value === '__custom__') {
        if (customContainer) customContainer.classList.remove('hidden');
        const textVal = customInput ? customInput.value : '';
        sfCategories[index].name = textVal;
    } else {
        if (customContainer) customContainer.classList.add('hidden');
        sfCategories[index].name = value;
    }
};

window.addSfCategory = () => {
    sfCategories.push({ name: "", image: "" });
    renderSfCategories();
};

window.updateSfCategory = (index, field, value) => {
    sfCategories[index][field] = value;
};

window.removeSfCategory = (index) => {
    sfCategories.splice(index, 1);
    renderSfCategories();
};

window.saveStorefrontSettings = async () => {
    const imgEl = document.getElementById('sf-hero-image');
    const titleEl = document.getElementById('sf-hero-title');
    const subtitleEl = document.getElementById('sf-hero-subtitle');
    const btnEl = document.getElementById('sf-hero-btn');

    const heroBanner = {
        image: imgEl ? imgEl.value : '',
        title: titleEl ? titleEl.value : '',
        subtitle: subtitleEl ? subtitleEl.value : '',
        buttonText: btnEl ? btnEl.value : ''
    };

    try {
        await setDoc(doc(db, "settings", "storefront"), {
            heroBanner,
            categories: sfCategories,
            updatedAt: new Date().toISOString()
        });
        showToast("Storefront Settings Saved!", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to save storefront.", "error");
    }
};

// Call this on load
document.addEventListener('DOMContentLoaded', () => {
    loadStorefrontSettings();

    // Email credentials form listener
    const emailForm = document.getElementById('email-credentials-form');
    if (emailForm) {
        emailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('settings-email-user').value.trim();
            const appPassword = document.getElementById('settings-email-pass').value.trim();

            try {
                await setDoc(doc(db, "settings", "email_config"), {
                    email,
                    appPassword,
                    updatedAt: new Date().toISOString()
                });
                showToast("Email Settings Saved!", "success");
            } catch (err) {
                console.error("Failed to save email settings:", err);
                showToast("Failed to save credentials: " + err.message, "error");
            }
        });
    }

    // Operational settings form listener
    const opForm = document.getElementById('store-operational-settings-form');
    if (opForm) {
        opForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const storeMode = document.getElementById('settingsStoreModeSelect').value;
            const autoOpenTime = document.getElementById('settingsAutoOpenTime') ? document.getElementById('settingsAutoOpenTime').value : '';
            const autoCloseTime = document.getElementById('settingsAutoCloseTime') ? document.getElementById('settingsAutoCloseTime').value : '';
            const assignmentMode = document.getElementById('settingsAssignmentModeSelect').value;
            const address = document.getElementById('settingsStoreAddress').value.trim();
            const allowedCities = document.getElementById('settingsAllowedCities') ? document.getElementById('settingsAllowedCities').value.trim() : '';
            const allowedZips = document.getElementById('settingsAllowedZips') ? document.getElementById('settingsAllowedZips').value.trim() : '';
            const deliveryCharge = Number(document.getElementById('settingsDeliveryCharge').value);
            const taxPercentage = Number(document.getElementById('settingsTaxPercentage').value);
            const minOrderForFreeDelivery = Number(document.getElementById('settingsMinOrderFreeDelivery').value);
            const contactPhone = document.getElementById('settingsStoreContact').value.trim();
            const instagram = document.getElementById('settingsInstagram').value.trim();
            const deliveryPaymentMethod = document.getElementById('settingsDeliveryPaymentMethod') ? document.getElementById('settingsDeliveryPaymentMethod').value : 'razorpay';
            const deliveryUpiId = document.getElementById('settingsDeliveryUpiId') ? document.getElementById('settingsDeliveryUpiId').value.trim() : '';
            const latestAppVersion = document.getElementById('settingsLatestAppVersion') ? document.getElementById('settingsLatestAppVersion').value.trim() : '';
            const apkDownloadUrl = document.getElementById('settingsApkDownloadUrl') ? document.getElementById('settingsApkDownloadUrl').value.trim() : '';
            const autoPrint = document.getElementById('settingsAutoPrintSelect') ? (document.getElementById('settingsAutoPrintSelect').value === 'true') : false;

            const isOnline = (storeMode === 'open' || storeMode === 'no-delivery');

            try {
                await setDoc(doc(db, "storeSettings", "info"), {
                    storeMode,
                    isOnline,
                    autoOpenTime,
                    autoCloseTime,
                    assignmentMode,
                    autoPrint,
                    address,
                    allowedCities,
                    allowedZips,
                    deliveryCharge,
                    taxPercentage,
                    minOrderForFreeDelivery,
                    contactPhone,
                    instagram,
                    deliveryPaymentMethod,
                    deliveryUpiId,
                    latestAppVersion,
                    apkDownloadUrl,
                    deliveryZones: currentStoreSettings.deliveryZones || [],
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                showToast("Operational Settings Saved Successfully!", "success");
            } catch (err) {
                console.error("Failed to save operational settings:", err);
                showToast("Failed to save operational settings: " + err.message, "error");
            }
        });
    }
});

// --- Delivery Zones Builder ---
window.renderDeliveryZones = () => {
    const container = document.getElementById('delivery-zones-container');
    if (!container) return;

    container.innerHTML = '';
    const zones = currentStoreSettings.deliveryZones || [];

    if (zones.length === 0) {
        container.innerHTML = '<p class="text-xs text-brand-white/40 text-center py-2">No custom zones. Standard Delivery Charge will apply.</p>';
        return;
    }

    zones.forEach((zone, index) => {
        container.innerHTML += `
            <div class="flex flex-col md:flex-row gap-3 items-center bg-white/5 p-3 rounded-xl border border-white/10">
                <div class="flex-1 w-full">
                    <label class="block text-[9px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">ZIP / PIN Code</label>
                    <input type="text" placeholder="e.g. 788030" value="${zone.zip || ''}" onchange="updateDeliveryZone(${index}, 'zip', this.value)" class="w-full bg-black/50 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-gold">
                </div>
                <div class="flex-1 w-full">
                    <label class="block text-[9px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Delivery Charge (₹)</label>
                    <input type="number" placeholder="e.g. 20" value="${zone.charge !== undefined ? zone.charge : ''}" onchange="updateDeliveryZone(${index}, 'charge', Number(this.value))" class="w-full bg-black/50 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-gold">
                </div>
                <div class="flex-1 w-full">
                    <label class="block text-[9px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Distance (km)</label>
                    <input type="number" step="0.1" placeholder="e.g. 2" value="${zone.distance !== undefined ? zone.distance : ''}" onchange="updateDeliveryZone(${index}, 'distance', Number(this.value))" class="w-full bg-black/50 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-gold">
                </div>
                <button type="button" onclick="removeDeliveryZone(${index})" class="mt-4 md:mt-0 p-2 text-brand-red/50 hover:text-brand-red transition-colors">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        `;
    });
    if (window.lucide) lucide.createIcons();
};

window.addDeliveryZone = () => {
    if (!currentStoreSettings.deliveryZones) currentStoreSettings.deliveryZones = [];
    currentStoreSettings.deliveryZones.push({ zip: '', charge: 0, distance: 0 });
    renderDeliveryZones();
};

window.updateDeliveryZone = (index, field, value) => {
    if (!currentStoreSettings.deliveryZones) return;
    currentStoreSettings.deliveryZones[index][field] = value;
};

window.removeDeliveryZone = (index) => {
    if (!currentStoreSettings.deliveryZones) return;
    currentStoreSettings.deliveryZones.splice(index, 1);
    renderDeliveryZones();
};

// --- Email Settings Management ---
async function loadEmailSettings() {
    try {
        const docRef = doc(db, "settings", "email_config");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const emailInput = document.getElementById('settings-email-user');
            const passInput = document.getElementById('settings-email-pass');
            if (emailInput) emailInput.value = data.email || '';
            if (passInput) passInput.value = data.appPassword || '';
        }
    } catch (e) {
        console.error("Failed to load email settings:", e);
    }
}
window.loadEmailSettings = loadEmailSettings;

window.sendTestInvoiceEmail = async () => {
    const recipient = document.getElementById('test-email-recipient').value.trim();
    if (!recipient) {
        showToast("Please enter a recipient email address!", "error");
        return;
    }

    const testBtn = document.querySelector('button[onclick="sendTestInvoiceEmail()"]');
    if (!testBtn) return;
    const originalContent = testBtn.innerHTML;
    testBtn.innerHTML = `<span class="animate-pulse flex items-center justify-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Sending...</span>`;
    testBtn.disabled = true;
    if (window.lucide) window.lucide.createIcons();

    const mockOrder = {
        id: "test" + Math.random().toString(36).substring(2, 10),
        email: recipient,
        customer: "Didi's Test Customer",
        phone: "9876543210",
        address: "Udharbond, Main Market Road, Silchar, Assam 788030",
        orderType: "delivery",
        paymentMethod: "online",
        timestamp: new Date().toISOString(),
        items: [
            { name: "Special Chicken Biryani", quantity: 2, price: 280 },
            { name: "Extra Salad", quantity: 1, price: 20 }
        ],
        deliveryCharge: 30,
        discount: 40,
        tipAmount: 10,
        total: 580 // (280*2 + 20 + 30 - 40 + 10)
    };

    try {
        await sendInvoiceEmail(mockOrder);
    } catch (err) {
        console.error("Test email failed:", err);
        showToast("Test email failed: " + err.message, "error");
    } finally {
        testBtn.innerHTML = originalContent;
        testBtn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }
};


// --- AI Auto-Generation ---
window.generateWithAI = async () => {
    const foodNameInput = document.getElementById('foodName');
    const foodName = foodNameInput.value.trim();

    if (!foodName) {
        showToast("Please enter an Item Name first!", "error");
        foodNameInput.focus();
        return;
    }

    const apiKey = "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";

    const btn = document.getElementById('ai-generate-btn');
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i> Thinking...`;
    btn.disabled = true;
    if (window.lucide) lucide.createIcons();

    const promptText = `Act as a restaurant menu data expert for an Indian restaurant. The user wants to add an item named "${foodName}".
Return ONLY a valid JSON object matching this exact structure, nothing else:
{
  "description": "A mouth-watering, 2-sentence description.",
  "price": 250,
  "category": "Biryani, Thali, or Momo (or pick/create one that fits best)",
  "isVeg": true or false,
  "imageUrl": "https://loremflickr.com/800/600/food,${encodeURIComponent(foodName)}",
  "customizations": [
    {
      "groupName": "Spice Level",
      "options": [
        { "name": "Mild", "price": 0 },
        { "name": "Spicy", "price": 10 }
      ]
    }
  ]
}
For the price, suggest a realistic Indian restaurant price in INR (Rupees). Suggest 2-3 customization groups that make sense for this dish.`;

    try {
        const response = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [{
                    role: "user",
                    content: promptText
                }],
                response_format: { type: "json_object" }
            })
        });

        const data = await response.json();

        if (data.error) {
            showToast("AI Error: " + data.error.message, "error");
        } else if (data.choices && data.choices.length > 0) {
            const resultText = data.choices[0].message.content.trim();
            let result;
            try {
                result = JSON.parse(resultText);
            } catch (e) {
                console.error("Failed to parse JSON:", resultText);
                showToast("AI returned invalid data format.", "error");
                return;
            }

            // Fill Description
            if (result.description) document.getElementById('foodDesc').value = result.description;

            // Fill Price
            if (result.price) document.getElementById('foodPrice').value = result.price;

            // Fill Category
            if (result.category) {
                const catSelect = document.getElementById('foodCategory');
                let found = Array.from(catSelect.options).some(opt => opt.value.toLowerCase() === result.category.toLowerCase());
                if (!found) {
                    const newOpt = document.createElement('option');
                    newOpt.value = result.category;
                    newOpt.innerText = result.category;
                    catSelect.appendChild(newOpt);
                }
                catSelect.value = Array.from(catSelect.options).find(opt => opt.value.toLowerCase() === result.category.toLowerCase()).value;
            }

            // Fill Veg/Non-Veg
            if (typeof result.isVeg === 'boolean') {
                document.getElementById('foodVeg').value = result.isVeg ? "true" : "false";
            }

            // Fill Image
            if (result.imageUrl) {
                document.getElementById('foodImage').value = result.imageUrl;
            }

            // Fill Customizations
            if (result.customizations && Array.isArray(result.customizations)) {
                const builder = document.getElementById('customization-builder');
                builder.innerHTML = '';

                result.customizations.forEach(group => {
                    const index = typeof custGroupCount !== 'undefined' ? custGroupCount++ : Math.floor(Math.random() * 10000);
                    const div = document.createElement('div');
                    div.className = 'bg-black/40 p-4 rounded-xl border border-white/5 mb-4 relative cust-group-block';

                    let optionsHtml = '';
                    if (group.options && Array.isArray(group.options)) {
                        group.options.forEach(opt => {
                            optionsHtml += `
                                <div class="flex gap-2 option-row">
                                    <input type="text" placeholder="Option Name" class="flex-1 bg-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none opt-name-input" value="${opt.name}">
                                    <input type="number" placeholder="+₹0" class="w-20 bg-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none opt-price-input" value="${opt.price}">
                                </div>
                            `;
                        });
                    }

                    div.innerHTML = `
                        <input type="text" placeholder="Group Name (e.g. Spice Level)" class="w-full bg-transparent border-b border-white/20 text-white font-bold mb-3 focus:outline-none focus:border-brand-gold pb-1 text-sm group-name-input" value="${group.groupName}">
                        <div id="options-container-${index}" class="space-y-2 mb-3 options-container">${optionsHtml}</div>
                        <button type="button" onclick="addOption(${index})" class="text-xs text-brand-gold font-bold hover:text-white">+ Add Option</button>
                    `;
                    builder.appendChild(div);
                });
            }

            showToast("Menu Item Auto-Filled!", "success");
        }
    } catch (error) {
        console.error(error);
        showToast("Failed to connect to AI.", "error");
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
        if (window.lucide) lucide.createIcons();
    }
};

// --- Order History ---
window.renderOrderHistory = () => {
    const list = document.getElementById('order-history-list');
    const summaryEl = document.getElementById('order-history-summary');
    if (!list || !summaryEl) return;

    const dateStr = document.getElementById('history-date-picker').value;
    const searchQuery = (document.getElementById('history-search').value || '').trim().toLowerCase();

    // Filter orders
    let orders = [...allOrders];

    if (dateStr) {
        orders = getOrdersForDate(dateStr);
    }

    if (searchQuery) {
        orders = orders.filter(o => {
            const orderId = ('#ord' + o.id.substring(0, 6)).toLowerCase();
            const customerName = (o.customer || '').toLowerCase();
            const phone = (o.phone || '').toLowerCase();
            return customerName.includes(searchQuery) || orderId.includes(searchQuery) || phone.includes(searchQuery);
        });
    }

    // Summary
    let totalRevenue = 0;
    let deliveredCount = 0;
    orders.forEach(o => {
        totalRevenue += Number(o.total || 0);
        if (o.status === 'Delivered' || o.status === 'Collected') deliveredCount++;
    });

    // Apply UI Limit for rendering
    const limitEl = document.getElementById('history-limit');
    if (limitEl && limitEl.value !== 'all') {
        const limitInt = parseInt(limitEl.value);
        if (!isNaN(limitInt)) orders = orders.slice(0, limitInt);
    }

    const dateLabel = dateStr
        ? safeFormatDate(dateStr + 'T00:00:00', 'full')
        : 'All Time';

    summaryEl.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="glass border border-white/10 rounded-2xl p-4 text-center">
                <p class="text-xs text-brand-white/50 mb-1">Period</p>
                <p class="text-sm font-bold text-brand-white">${dateLabel}</p>
            </div>
            <div class="glass border border-white/10 rounded-2xl p-4 text-center">
                <p class="text-xs text-brand-white/50 mb-1">Total Orders</p>
                <p class="text-2xl font-black text-brand-white">${orders.length}</p>
            </div>
            <div class="glass border border-white/10 rounded-2xl p-4 text-center">
                <p class="text-xs text-brand-white/50 mb-1">Completed</p>
                <p class="text-2xl font-black text-green-500">${deliveredCount}</p>
            </div>
            <div class="glass border border-white/10 rounded-2xl p-4 text-center">
                <p class="text-xs text-brand-white/50 mb-1">Revenue</p>
                <p class="text-2xl font-black text-brand-gold">₹${totalRevenue}</p>
            </div>
        </div>
    `;

    // Table rows
    if (orders.length === 0) {
        list.innerHTML = `<tr><td colspan="8" class="text-center py-16 text-brand-white/30">${searchQuery ? '🔍 No orders match your search' : '📅 Select a date or search to view orders'}</td></tr>`;
        return;
    }

    list.innerHTML = '';
    orders.forEach(o => {
        const dateStr2 = safeFormatDate(o.timestamp, 'date');
        const timeStr = safeFormatDate(o.timestamp, 'time');
        const itemsCount = (o.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0);
        const orderId = '#' + (o.orderNumber ? String(o.orderNumber).padStart(5, '0') : 'ORD' + o.id.substring(0, 6).toUpperCase());

        let statusClass = 'bg-white/10 text-brand-white';
        if (o.status === 'Delivered' || o.status === 'Collected') statusClass = 'bg-green-500/20 text-green-500';
        else if (o.status === 'Rejected') statusClass = 'bg-red-500/20 text-red-500';
        else if (o.status === 'Pending') statusClass = 'bg-yellow-500/20 text-yellow-500';
        else if (o.status === 'Cooking') statusClass = 'bg-brand-gold/20 text-brand-gold';

        list.innerHTML += `
            <tr class="hover:bg-white/5 transition-colors cursor-pointer" onclick="showHistoryDetail('${o.id}')">
                <td class="px-6 py-4 text-sm font-bold text-brand-gold whitespace-nowrap">${orderId}</td>
                <td class="px-6 py-4 text-sm text-brand-white/70 whitespace-nowrap">${dateStr2}<br><span class="text-[10px] text-brand-white/40">${timeStr}</span></td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-brand-gold/20 text-brand-gold flex items-center justify-center font-bold text-xs flex-shrink-0">${(o.customer || '?').charAt(0).toUpperCase()}</div>
                        <div>
                            <p class="text-sm font-bold text-brand-white">${o.customer}</p>
                            <p class="text-[10px] text-brand-white/40">${o.phone || ''}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-sm text-brand-white/70">${itemsCount} item(s)</td>
                <td class="px-6 py-4"><span class="text-xs font-bold uppercase ${o.orderType === 'pickup' ? 'text-blue-400' : 'text-brand-gold'}">${o.orderType === 'pickup' ? 'Pickup' : 'Delivery'}</span></td>
                <td class="px-6 py-4"><span class="px-3 py-1 rounded-full text-[10px] font-bold ${statusClass}">${o.status}</span></td>
                <td class="px-6 py-4 text-right text-sm font-black text-brand-gold">₹${o.total}</td>
                <td class="px-6 py-4 text-center"><button class="text-brand-white/50 hover:text-brand-gold transition-colors"><i data-lucide="eye" class="w-4 h-4"></i></button></td>
            </tr>
        `;
    });

    if (window.lucide) lucide.createIcons();
};

// --- Order History Detail Modal ---
window.showHistoryDetail = (orderId) => {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    viewingOrderId = orderId;

    const dateStr = safeFormatDate(order.timestamp, 'full');
    const timeStr = safeFormatDate(order.timestamp, 'time');

    let statusClass = 'bg-white/10 text-brand-white';
    if (order.status === 'Delivered' || order.status === 'Collected') statusClass = 'bg-green-500/20 text-green-500';
    else if (order.status === 'Rejected') statusClass = 'bg-red-500/20 text-red-500';
    else if (order.status === 'Pending') statusClass = 'bg-yellow-500/20 text-yellow-500';

    let itemsHtml = (order.items || []).map(i => {
        const custStr = i.customizations ? Object.values(i.customizations).join(', ') : '';
        return `
            <div class="flex justify-between items-start py-3 border-b border-white/5 last:border-0">
                <div class="flex-1">
                    <p class="text-sm font-bold text-brand-white">${i.name}</p>
                    ${custStr ? `<p class="text-[10px] text-brand-gold mt-0.5">${custStr}</p>` : ''}
                    <p class="text-[10px] text-brand-white/40 mt-0.5">x${i.quantity} • ₹${i.price} each</p>
                </div>
                <p class="text-sm font-bold text-brand-white/70">₹${i.price * i.quantity}</p>
            </div>
        `;
    }).join('');

    // Fetch delivery boy name if assigned
    let driverName = 'Not Assigned';
    if (order.deliveryBoyId) {
        const boy = allDeliveryBoys.find(b => b.id === order.deliveryBoyId);
        if (boy) driverName = `${boy.name} (${boy.phone})`;
    }

    const content = document.getElementById('history-detail-content');
    content.innerHTML = `
            <div class="flex items-center gap-4 mb-6">
                <div class="w-14 h-14 rounded-full bg-brand-gold/20 text-brand-gold flex items-center justify-center font-black text-xl flex-shrink-0">
                    ${(order.customer || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                    <h3 class="text-xl font-black text-brand-white">${order.customer}</h3>
                    <p class="text-xs text-brand-gold">#${order.orderNumber ? String(order.orderNumber).padStart(5, '0') : 'ORD' + order.id.substring(0, 6).toUpperCase()}</p>
                </div>
            </div>

            <div class="space-y-3 mb-6">
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Phone</span><span class="text-brand-white font-medium">${order.phone || 'N/A'}</span></div>
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Date</span><span class="text-brand-white font-medium">${dateStr}</span></div>
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Time</span><span class="text-brand-white font-medium">${timeStr}</span></div>
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">restaurant</span><span class="text-brand-white font-medium">Didi's Biryani</span></div>
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Outlet Address</span><span class="text-brand-white text-xs font-medium text-right max-w-[200px]">${currentStoreSettings.address}</span></div>
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Type</span><span class="text-brand-white font-medium">${order.orderType === 'pickup' ? 'Pickup' : 'Delivery'}</span></div>
                ${order.address ? `<div class="flex justify-between text-sm"><span class="text-brand-white/50">Address</span><span class="text-brand-white font-medium text-right max-w-[200px]">${order.address}</span></div>` : ''}
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Payment Mode</span><span class="text-brand-white font-medium uppercase">${order.paymentMethod || 'COD'}</span></div>
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Transaction ID</span><span class="text-brand-white font-mono text-xs truncate max-w-[150px]" title="${order.transactionId || order.paymentId || 'N/A'}">${order.transactionId || order.paymentId || 'N/A'}</span></div>
                ${order.orderType !== 'pickup' ? `<div class="flex justify-between text-sm"><span class="text-brand-white/50">Delivery Boy</span><span class="text-brand-gold font-medium">${driverName}</span></div>` : ''}
                <div class="flex justify-between text-sm"><span class="text-brand-white/50">Status</span><span class="px-3 py-1 rounded-full text-[10px] font-bold ${statusClass}">${order.status}</span></div>
            </div>

            <div class="border-t border-white/10 pt-4 mb-4">
                <h4 class="text-xs font-bold text-brand-white/50 uppercase tracking-widest mb-3">Items Ordered</h4>
                ${itemsHtml}
            </div>
            
            ${(() => {
            if (order.review) {
                const stars = Array(5).fill(0).map((_, i) =>
                    `<i data-lucide="star" class="w-4 h-4 ${i < order.review.rating ? 'fill-brand-gold text-brand-gold' : 'text-white/20'}"></i>`
                ).join('');
                return `
                        <div class="border-t border-brand-gold/30 pt-4 mb-4 bg-gradient-to-r from-brand-gold/5 to-transparent -mx-6 px-6 pb-4">
                            <h4 class="text-xs font-bold text-brand-gold flex items-center gap-2 mb-2"><i data-lucide="star" class="w-4 h-4 fill-brand-gold"></i> Customer Review</h4>
                            <div class="flex items-center gap-2 mb-2">${stars}</div>
                            <p class="text-sm text-brand-white/90 italic border-l-2 border-brand-gold/50 pl-3 py-1">${order.review.text ? `"${order.review.text}"` : 'No comment provided.'}</p>
                            <p class="text-[10px] text-brand-white/40 mt-2 font-medium tracking-wide">${safeFormatDate(order.review.timestamp, 'datetime')}</p>
                        </div>
                    `;
            }
            return '';
        })()}

            <div class="border-t border-white/10 pt-4 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div class="flex gap-2 w-full sm:w-auto">
                    <button onclick="openEditOrderModal()" class="flex-1 sm:flex-none px-4 py-2 bg-white/10 text-brand-white text-xs font-bold rounded-lg hover:bg-brand-gold hover:text-black transition-all flex items-center justify-center gap-2">
                        <i data-lucide="edit" class="w-4 h-4"></i> Edit
                    </button>
                    <button onclick="printOrderKOT()" class="flex-1 sm:flex-none px-4 py-2 bg-white/10 text-brand-white text-xs font-bold rounded-lg hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2">
                        <i data-lucide="printer" class="w-4 h-4"></i> KOT
                    </button>
                    <button onclick="printOrderInvoice()" class="flex-1 sm:flex-none px-4 py-2 bg-brand-gold text-brand-black text-xs font-bold rounded-lg hover:bg-white transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(212, 160, 23,0.3)]">
                        <i data-lucide="printer" class="w-4 h-4"></i> Slip
                    </button>
                </div>
                <div class="flex justify-between w-full sm:w-auto items-center gap-4">
                    <span class="text-sm font-bold text-brand-white">Total</span>
                    <span class="text-xl font-black text-brand-gold">₹${order.total}</span>
                </div>
            </div>
        `;

    window.showModal('history-detail-modal');
    if (window.lucide) lucide.createIcons();
};

// --- Thermal Print Logic ---
window.printOrderInvoice = () => {
    if (!viewingOrderId) {
        showToast('No order selected to print!', 'error');
        return;
    }
    const o = allOrders.find(ord => ord.id === viewingOrderId);
    if (!o) {
        showToast('Order not found!', 'error');
        return;
    }
    printDeliverySlip(o);
};

window.printOrderKOT = () => {
    if (!viewingOrderId) {
        showToast('No order selected to print!', 'error');
        return;
    }
    const o = allOrders.find(ord => ord.id === viewingOrderId);
    if (!o) {
        showToast('Order not found!', 'error');
        return;
    }
    printKOT(o);
};

function populateCategoryDropdown() {
    const select = document.getElementById('foodCategory');
    if (!select) return;

    // Remember current selected value
    const currentVal = select.value;

    // Core categories
    const categories = new Set(['Biryani', 'Thali', 'Momo']);

    // Scan all menu items for existing categories
    allMenu.forEach(item => {
        if (item.category) {
            categories.add(item.category);
        }
    });

    // Clear existing options
    select.innerHTML = '';

    // Build options
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        select.appendChild(opt);
    });

    // Add custom option at the bottom
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.innerText = '+ Add Custom Category...';
    select.appendChild(customOpt);

    // Restore selection if it still exists
    if (Array.from(select.options).some(opt => opt.value === currentVal)) {
        select.value = currentVal;
    }
}

// Export Orders to CSV (Customer Details & Order History)
window.exportOrdersToCSV = () => {
    if (typeof allOrders === 'undefined' || !allOrders || allOrders.length === 0) {
        if (typeof showToast === 'function') showToast("No orders available to export.", "error");
        else alert("No orders available to export.");
        return;
    }

    let csvContent = "Order ID,Date,Time,Customer Name,Customer Email,Phone Number,Delivery Address,Order Type,Payment Method,Items Summary,Total Amount,Status\n";

    allOrders.forEach(o => {
        const id = `"#ORD${(o.id || '').substring(0, 6).toUpperCase()}"`;
        const date = `"${safeFormatDate(o.timestamp, 'date')}"`;
        const time = `"${safeFormatDate(o.timestamp, 'time')}"`;
        const name = `"${(o.customer || '').replace(/"/g, '""')}"`;
        const email = `"${(o.email || '').replace(/"/g, '""')}"`;
        const phone = `"${(o.phone || '').replace(/"/g, '""')}"`;
        const address = `"${(o.address || '').replace(/"/g, '""')}"`;
        const type = `"${(o.orderType || 'delivery').replace(/"/g, '""')}"`;
        const payment = `"${(o.paymentMethod || '').replace(/"/g, '""')}"`;

        let itemsStr = "";
        if (Array.isArray(o.items)) {
            itemsStr = o.items.map(i => `${i.quantity}x ${i.name}`).join(' | ');
        }
        const items = `"${itemsStr.replace(/"/g, '""')}"`;

        const total = o.total || 0;
        const status = `"${(o.status || '').replace(/"/g, '""')}"`;

        csvContent += `${id},${date},${time},${name},${email},${phone},${address},${type},${payment},${items},${total},${status}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Didi_Biryani_Orders_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (typeof showToast === 'function') showToast("Exported orders to CSV!", "success");
};

// --- Banners / Storefront CMS Logic ---
let allBanners = [];
let editingBannerId = null;

// Listen to Banners Collection
onSnapshot(collection(db, "banners"), (snap) => {
    allBanners = [];
    snap.forEach(docSnap => {
        allBanners.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort by creation time if available
    allBanners.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    renderAdminBanners();
});

// Render Banners in Storefront Table
function renderAdminBanners() {
    const tbody = document.getElementById('banners-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (allBanners.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="py-8 text-center text-sm text-brand-white/40">
                    <p class="font-bold">No sliding banners configured yet.</p>
                    <p class="text-xs text-brand-white/20 mt-1">Create one using the form on the left.</p>
                </td>
            </tr>
        `;
        return;
    }

    allBanners.forEach(b => {
        const statusBadge = b.isActive
            ? `<span class="px-2.5 py-0.5 bg-green-500/20 text-green-500 border border-green-500/30 rounded text-[10px] font-black uppercase tracking-wider">Active</span>`
            : `<span class="px-2.5 py-0.5 bg-white/5 text-brand-white/30 border border-white/10 rounded text-[10px] font-black uppercase tracking-wider">Inactive</span>`;

        let targetText = b.btnLink;
        if (b.linkType === 'category') {
            targetText = `Category: ${b.btnLink}`;
        } else if (b.linkType === 'dish') {
            const dish = allMenu.find(m => m.id === b.btnLink);
            targetText = `Dish Modal: ${dish ? dish.name : 'Unknown Dish'}`;
        }

        tbody.innerHTML += `
            <tr class="hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0">
                <td class="p-4 w-28">
                    <div class="w-20 h-12 bg-black/50 border border-white/10 rounded-lg overflow-hidden">
                        <img src="${b.image || 'https://via.placeholder.com/150'}" class="w-full h-full object-cover">
                    </div>
                </td>
                <td class="p-4">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-[9px] font-black text-brand-gold bg-brand-gold/10 border border-brand-gold/20 px-1.5 py-0.5 rounded uppercase tracking-wider">${b.badge || 'PROMO'}</span>
                        <h4 class="font-black text-brand-white text-sm truncate max-w-[200px]">${b.title}</h4>
                    </div>
                    <p class="text-xs text-brand-white/60 line-clamp-1 max-w-[300px]">${b.subtitle}</p>
                    <p class="text-[9px] text-brand-white/40 font-semibold mt-1">Action: <span class="text-brand-gold">${b.btnText}</span> → <span class="text-brand-white/50">${targetText}</span></p>
                </td>
                <td class="p-4 text-center">
                    <button onclick="toggleBannerActiveStatus('${b.id}', ${b.isActive})" class="focus:outline-none cursor-pointer">
                        ${statusBadge}
                    </button>
                </td>
                <td class="p-4 text-right">
                    <div class="flex justify-end gap-2">
                        <button onclick="editBanner('${b.id}')" class="p-2 bg-brand-gold/10 text-brand-gold border border-brand-gold/20 hover:bg-brand-gold hover:text-black rounded-lg transition-colors" title="Edit Slide"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
                        <button onclick="deleteBanner('${b.id}')" class="p-2 bg-black/50 text-brand-red border border-white/5 hover:bg-brand-red hover:text-white rounded-lg transition-colors" title="Delete Slide"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });

    if (window.lucide) lucide.createIcons();
}

// Save Slider Configuration (Auto-slide timer)
window.saveSliderSettings = async (event) => {
    event.preventDefault();
    const intervalVal = Number(document.getElementById('sliderInterval').value);
    if (isNaN(intervalVal) || intervalVal < 1) {
        showToast("Please enter a valid interval duration!", "error");
        return;
    }

    try {
        await updateDoc(doc(db, "storeSettings", "info"), {
            bannerInterval: intervalVal
        });
        showToast("Auto-slide settings updated successfully!", "success");
    } catch (e) {
        console.error("Error saving slider settings", e);
        showToast("Failed to save slider settings.", "error");
    }
};

// Toggle banner active status
window.toggleBannerActiveStatus = async (id, currentStatus) => {
    try {
        await updateDoc(doc(db, "banners", id), {
            isActive: !currentStatus
        });
        showToast("Banner status updated!", "success");
    } catch (e) {
        console.error(e);
        showToast("Failed to toggle banner status.", "error");
    }
};

// Edit Banner
window.editBanner = (id) => {
    const banner = allBanners.find(b => b.id === id);
    if (!banner) return;

    editingBannerId = id;

    document.getElementById('bannerBadge').value = banner.badge || '';
    document.getElementById('bannerTitle').value = banner.title || '';
    document.getElementById('bannerSubtitle').value = banner.subtitle || '';
    document.getElementById('bannerImage').value = banner.image || '';
    document.getElementById('bannerBtnText').value = banner.btnText || 'Order Now';
    document.getElementById('bannerActive').checked = banner.isActive !== false;

    const linkType = banner.linkType || 'custom';
    document.getElementById('bannerLinkType').value = linkType;
    if (window.toggleBannerLinkTypeField) window.toggleBannerLinkTypeField();

    if (linkType === 'custom') {
        document.getElementById('bannerBtnLink').value = banner.btnLink || '';
    } else if (linkType === 'category') {
        document.getElementById('bannerCategoryLink').value = banner.btnLink || '';
    } else if (linkType === 'dish') {
        document.getElementById('bannerDishLink').value = banner.btnLink || '';
    }

    document.getElementById('banner-form-title').innerText = "Edit Banner Details";
    document.getElementById('banner-submit-btn').innerText = "Update Slide";
    document.getElementById('banner-cancel-btn').classList.remove('hidden');

    // Scroll form into view
    const formContainer = document.getElementById('create-banner-form');
    if (formContainer) formContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// Cancel Editing
window.cancelBannerEdit = () => {
    editingBannerId = null;
    document.getElementById('create-banner-form').reset();
    document.getElementById('bannerLinkType').value = 'custom';
    if (window.toggleBannerLinkTypeField) window.toggleBannerLinkTypeField();

    document.getElementById('banner-form-title').innerText = "Create New Banner";
    document.getElementById('banner-submit-btn').innerText = "Create Banner";
    document.getElementById('banner-cancel-btn').classList.add('hidden');
};

// Delete Banner
window.deleteBanner = async (id) => {
    if (!confirm("Are you sure you want to delete this banner permanently?")) return;

    try {
        await deleteDoc(doc(db, "banners", id));
        showToast("Banner deleted successfully!", "success");
        if (editingBannerId === id) cancelBannerEdit();
    } catch (e) {
        console.error(e);
        showToast("Failed to delete banner.", "error");
    }
};

// Form submission handler for creating/editing banners
document.addEventListener('DOMContentLoaded', () => {
    const bannerForm = document.getElementById('create-banner-form');
    if (bannerForm) {
        bannerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const linkType = document.getElementById('bannerLinkType').value;
            let btnLink = '';
            if (linkType === 'custom') {
                btnLink = document.getElementById('bannerBtnLink').value.trim();
            } else if (linkType === 'category') {
                btnLink = document.getElementById('bannerCategoryLink').value;
            } else if (linkType === 'dish') {
                btnLink = document.getElementById('bannerDishLink').value;
            }

            const data = {
                badge: document.getElementById('bannerBadge').value.trim(),
                title: document.getElementById('bannerTitle').value.trim(),
                subtitle: document.getElementById('bannerSubtitle').value.trim(),
                image: document.getElementById('bannerImage').value.trim(),
                btnText: document.getElementById('bannerBtnText').value.trim() || 'Order Now',
                btnLink: btnLink,
                linkType: linkType,
                isActive: document.getElementById('bannerActive').checked,
                createdAt: new Date().toISOString()
            };

            try {
                if (editingBannerId) {
                    await updateDoc(doc(db, "banners", editingBannerId), data);
                    showToast("Banner updated successfully!", "success");
                    cancelBannerEdit();
                } else {
                    await addDoc(collection(db, "banners"), data);
                    showToast("Banner created successfully!", "success");
                    document.getElementById('create-banner-form').reset();
                    if (window.toggleBannerLinkTypeField) window.toggleBannerLinkTypeField();
                }
            } catch (err) {
                console.error("Error saving banner:", err);
                showToast("Failed to save banner: " + err.message, "error");
            }
        });
    }

    const sliderForm = document.getElementById('slider-settings-form');
    if (sliderForm) {
        sliderForm.addEventListener('submit', window.saveSliderSettings);
    }

    // Loyalty Settings Form submission
    const loyaltyForm = document.getElementById('loyalty-settings-form');
    if (loyaltyForm) {
        loyaltyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loyaltyActive = document.getElementById('loyaltyActive').checked;
            const loyaltyThreshold = Number(document.getElementById('loyaltyThreshold').value);
            const loyaltyReward = Number(document.getElementById('loyaltyReward').value);
            const loyaltyExpiryDays = Number(document.getElementById('loyaltyExpiryDays').value) || 0;

            try {
                await setDoc(doc(db, "storeSettings", "info"), {
                    loyaltyActive,
                    loyaltyThreshold,
                    loyaltyReward,
                    loyaltyExpiryDays
                }, { merge: true });
                showToast("Loyalty program settings saved successfully!", "success");
            } catch (err) {
                console.error("Failed to save loyalty settings:", err);
                showToast("Failed to save loyalty settings.", "error");
            }
        });
    }
});

// Sync Auto-slide Interval value on settings snapshot update
const originalUpdateStoreStatusUI = updateStoreStatusUI;
updateStoreStatusUI = () => {
    originalUpdateStoreStatusUI();

    const sliderInput = document.getElementById('sliderInterval');
    if (sliderInput && currentStoreSettings.bannerInterval) {
        sliderInput.value = currentStoreSettings.bannerInterval;
    }
};

window.toggleBannerLinkTypeField = () => {
    const linkType = document.getElementById('bannerLinkType').value;
    const customContainer = document.getElementById('banner-custom-link-container');
    const catContainer = document.getElementById('banner-category-link-container');
    const dishContainer = document.getElementById('banner-dish-link-container');

    if (!customContainer || !catContainer || !dishContainer) return;

    customContainer.classList.add('hidden');
    catContainer.classList.add('hidden');
    dishContainer.classList.add('hidden');

    if (linkType === 'custom') {
        customContainer.classList.remove('hidden');
    } else if (linkType === 'category') {
        catContainer.classList.remove('hidden');
    } else if (linkType === 'dish') {
        dishContainer.classList.remove('hidden');
    }
};

window.openEditOrderModal = () => {
    if (!viewingOrderId) return;
    const o = allOrders.find(ord => ord.id === viewingOrderId);
    if (!o) return;

    document.getElementById('edit-order-name').value = o.customer || '';
    document.getElementById('edit-order-phone').value = o.phone || '';
    document.getElementById('edit-order-email').value = o.email || '';
    document.getElementById('edit-order-address').value = o.address || '';
    document.getElementById('edit-order-notes').value = o.notes || '';

    window.showModal('edit-order-modal');
};

window.saveOrderEdits = async () => {
    if (!viewingOrderId) return;

    const name = document.getElementById('edit-order-name').value.trim();
    const phone = document.getElementById('edit-order-phone').value.trim();
    const email = document.getElementById('edit-order-email').value.trim();
    const address = document.getElementById('edit-order-address').value.trim();
    const notes = document.getElementById('edit-order-notes').value.trim();

    try {
        await updateDoc(doc(db, "orders", viewingOrderId), {
            customer: name,
            phone: phone,
            email: email,
            address: address,
            notes: notes
        });
        showToast("Order details updated successfully!", "success");
        window.hideModal('edit-order-modal');

        // Re-render modals if they are open
        if (!document.getElementById('history-detail-modal').classList.contains('hidden')) {
            showHistoryDetail(viewingOrderId);
        } else {
            viewOrderDetails(viewingOrderId);
        }
    } catch (e) {
        console.error("Error updating order:", e);
        showToast("Failed to update order. Check permissions.", "error");
    }
};

// ==========================================
// CUSTOMER WALLET & LOYALTY CONTROLS
// ==========================================

window.openCreditAllWalletsModal = () => {
    document.getElementById('credit-all-amount').value = '';
    const expiryInput = document.getElementById('credit-all-expiry');
    if (expiryInput) expiryInput.value = '';
    window.showModal('credit-all-modal');
};

window.submitCreditAllWallets = async () => {
    const amountInput = document.getElementById('credit-all-amount');
    const amount = Number(amountInput.value);
    const expiryInput = document.getElementById('credit-all-expiry');
    const expiryDate = expiryInput ? expiryInput.value : '';

    if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid credit amount.", "error");
        return;
    }

    window.hideModal('credit-all-modal');
    showToast("Processing wallet credits. Please wait...", "info");

    try {
        const promises = allUsers.map(u => {
            return addWalletEntry(u.id, amount, expiryDate, 'credit_all');
        });

        await Promise.all(promises);
        showToast(`Successfully credited ₹${amount} to all ${allUsers.length} customer wallets!`, "success");
    } catch (err) {
        console.error("Error crediting wallets:", err);
        showToast("Failed to credit wallets. Check admin permissions.", "error");
    }
};

window.openGiftWalletModal = (userId, name) => {
    document.getElementById('gift-customer-id').value = userId;
    document.getElementById('gift-customer-name').innerText = name;
    document.getElementById('gift-wallet-amount').value = '';
    const expiryInput = document.getElementById('gift-wallet-expiry');
    if (expiryInput) expiryInput.value = '';
    window.showModal('gift-wallet-modal');
};

window.submitGiftWallet = async () => {
    const userId = document.getElementById('gift-customer-id').value;
    const amountInput = document.getElementById('gift-wallet-amount');
    const amount = Number(amountInput.value);
    const expiryInput = document.getElementById('gift-wallet-expiry');
    const expiryDate = expiryInput ? expiryInput.value : '';

    if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid gift amount.", "error");
        return;
    }

    window.hideModal('gift-wallet-modal');

    try {
        await addWalletEntry(userId, amount, expiryDate, 'gift');
        showToast(`Successfully gifted ₹${amount} to customer's wallet!`, "success");
    } catch (err) {
        console.error("Error gifting wallet:", err);
        showToast("Failed to gift wallet.", "error");
    }
};

// Attach dynamic event listeners for wallet controls
document.getElementById('open-credit-all-btn')?.addEventListener('click', () => {
    window.openCreditAllWalletsModal();
});
document.getElementById('submit-credit-all-btn')?.addEventListener('click', () => {
    window.submitCreditAllWallets();
});
document.getElementById('submit-gift-wallet-btn')?.addEventListener('click', () => {
    window.submitGiftWallet();
});
document.getElementById('close-credit-all-modal-btn')?.addEventListener('click', () => {
    window.hideModal('credit-all-modal');
});
document.getElementById('cancel-credit-all-modal-btn')?.addEventListener('click', () => {
    window.hideModal('credit-all-modal');
});
document.getElementById('close-gift-wallet-modal-btn')?.addEventListener('click', () => {
    window.hideModal('gift-wallet-modal');
});
document.getElementById('cancel-gift-wallet-modal-btn')?.addEventListener('click', () => {
    window.hideModal('gift-wallet-modal');
});


// --- Automated Chat Cleanup ---
// Runs lazily in the background when admin loads
async function cleanupOldMessages() {
    try {
        const snap = await getDocs(collection(db, "messages"));
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        let deletedCount = 0;
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const msgDate = new Date(data.timestamp);
            if (msgDate < sevenDaysAgo) {
                deleteDoc(doc(db, "messages", docSnap.id));
                deletedCount++;
            }
        });
        if (deletedCount > 0) {
            console.log(`[Admin] Cleaned up ${deletedCount} old messages (> 7 days).`);
        }
    } catch (e) {
        console.error("Error cleaning up old messages:", e);
    }
}
setTimeout(cleanupOldMessages, 8000); // Run 8 seconds after load to not block main thread

// ==========================================
// MANUAL ORDER (POS) LOGIC
// ==========================================

let manualCart = [];
let manualCustomerData = null;

window.searchManualCustomer = async () => {
    const phoneInput = document.getElementById('manualSearchPhone').value.trim();
    if (!phoneInput || phoneInput.length < 10) {
        showToast("Please enter a valid 10-digit phone number.", "error");
        return;
    }

    try {
        // 1. Check orders collection for previous orders by this phone
        const qOrders = query(collection(db, "orders"), where("phone", "==", phoneInput));
        const orderSnap = await getDocs(qOrders);
        
        let foundName = '';
        let foundAddress = '';
        let foundEmail = '';
        
        if (!orderSnap.empty) {
            // Get the most recent order by sorting or just picking the first one
            // We sort by timestamp descending locally if there are multiple
            const orders = [];
            orderSnap.forEach(doc => orders.push(doc.data()));
            orders.sort((a, b) => {
                const ta = new Date(a.timestamp).getTime() || 0;
                const tb = new Date(b.timestamp).getTime() || 0;
                return tb - ta;
            });

            const latestOrder = orders[0];
            foundName = latestOrder.customer || latestOrder.name || '';
            foundAddress = latestOrder.address || '';
            foundEmail = latestOrder.email || '';
        } else {
            // 2. Fallback: Check users collection
            const qUsers = query(collection(db, "users"), where("phone", "==", phoneInput));
            const userSnap = await getDocs(qUsers);
            if (!userSnap.empty) {
                const userData = userSnap.docs[0].data();
                foundName = userData.name || '';
                foundAddress = userData.address || '';
                foundEmail = userData.email || '';
            }
        }

        document.getElementById('manualCustPhone').value = phoneInput;
        
        if (foundName || foundAddress) {
            document.getElementById('manualCustName').value = foundName;
            document.getElementById('manualCustAddress').value = foundAddress;
            document.getElementById('manualCustEmail').value = foundEmail !== 'manual@didisbiryani.in' ? foundEmail : '';
            showToast("Customer found! Details auto-filled.", "success");
        } else {
            document.getElementById('manualCustName').value = '';
            document.getElementById('manualCustAddress').value = '';
            document.getElementById('manualCustEmail').value = '';
            showToast("New customer! Please enter details.", "info");
        }

    } catch (e) {
        console.error("Error searching customer:", e);
        showToast("Error searching for customer.", "error");
    }
};

window.saveManualCustomerDetails = async () => {
    const name = document.getElementById('manualCustName').value.trim();
    const phone = document.getElementById('manualCustPhone').value.trim();
    const address = document.getElementById('manualCustAddress').value.trim();
    const email = document.getElementById('manualCustEmail').value.trim();

    if (!name || !phone) {
        showToast("Name and Phone are required to save.", "error");
        return;
    }

    try {
        // We can just save a dummy order with 0 total just to keep the record, 
        // OR better yet, let's create a profile in the `users` collection.
        // We will use the phone number as the doc ID to ensure uniqueness.
        const userRef = doc(db, "users", "manual_" + phone);
        await setDoc(userRef, {
            name: name,
            phone: phone,
            email: email,
            address: address,
            isManual: true,
            timestamp: new Date().toISOString()
        }, { merge: true });

        showToast("Customer details saved successfully!", "success");
    } catch (e) {
        console.error("Error saving manual customer:", e);
        showToast("Error saving customer details.", "error");
    }
};

window.renderManualMenuSelect = () => {
    const select = document.getElementById('manualMenuSelect');
    if (!select) return;
    
    let html = `<option value="">-- Select a Menu Item --</option>`;
    
    // allMenu is already loaded globally by admin.js
    const availableItems = allMenu.filter(i => i.status === 'Available');
    
    // Group by category
    const grouped = {};
    availableItems.forEach(item => {
        const cat = item.category || 'Other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    Object.keys(grouped).sort().forEach(cat => {
        html += `<optgroup label="${cat}">`;
        grouped[cat].forEach(item => {
            html += `<option value="${item.id}">${item.name} - ₹${item.price}</option>`;
        });
        html += `</optgroup>`;
    });

    select.innerHTML = html;
};

// Call this once allMenu is populated (e.g. inside the existing onSnapshot in admin.js)
// We will hook it in a setTimeout just to be safe, or we can just call it when they switch to the tab.
document.getElementById('nav-manual-order').addEventListener('click', () => {
    if (document.getElementById('manualMenuSelect').options.length <= 1) {
        renderManualMenuSelect();
    }
});

let manualCustItem = null;
let manualCustSelectedVariantPrice = null;
let manualCustQty = 1;

window.openManualCustomizationModal = (item) => {
    manualCustItem = item;
    manualCustQty = 1;
    manualCustSelectedVariantPrice = item.variants && item.variants.length > 0 ? Number(item.variants[0].price) : Number(item.price);
    
    document.getElementById('manual-cust-title').innerText = item.name;
    document.getElementById('manual-cust-qty').innerText = manualCustQty;
    
    const content = document.getElementById('manual-cust-content');
    content.innerHTML = '';
    
    // 1. Portion Size Variants Selection
    if (item.variants && item.variants.length > 0) {
        let variantHtml = `
            <div class="cust-group variant-selection-group" data-group-name="Portion">
                <h4 class="text-xs font-bold text-brand-white/70 uppercase tracking-widest mb-3">Choose Portion / Size</h4>
                <div class="grid grid-cols-2 gap-3">
        `;
        item.variants.forEach((v, idx) => {
            const isSelected = idx === 0;
            const borderClass = isSelected ? 'border-brand-gold bg-brand-gold/10 ring-1 ring-brand-gold' : 'border-white/10 hover:bg-white/5';
            const checkedAttr = isSelected ? 'checked' : '';
            variantHtml += `
                <label class="flex items-center justify-between border ${borderClass} rounded-2xl p-4 cursor-pointer transition-all relative">
                    <div class="flex items-center gap-3">
                        <input type="radio" name="manual-variant-choice" class="variant-radio accent-brand-gold" 
                            data-variant-label="${v.label}" data-variant-price="${v.price}" ${checkedAttr} 
                            onclick="selectManualVariant(this)">
                        <span class="text-xs font-bold text-white">${v.label}</span>
                    </div>
                    <span class="text-xs font-black text-brand-gold">₹${v.price}</span>
                </label>
            `;
        });
        variantHtml += `
                </div>
            </div>
        `;
        content.innerHTML += variantHtml;
    }
    
    // 2. Extra Addons Selection
    if (item.customizations && item.customizations.length > 0) {
        item.customizations.forEach(group => {
            let groupHtml = `
                <div class="cust-group space-y-3" data-group-name="${group.name}">
                    <h4 class="text-xs font-bold text-brand-white/70 uppercase tracking-widest border-b border-white/5 pb-2">
                        ${group.name}
                    </h4>
                    <div class="space-y-2">
            `;
            group.options.forEach(opt => {
                groupHtml += `
                    <div class="flex items-center justify-between gap-4 p-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors">
                        <div>
                            <span class="text-xs font-bold text-white">${opt.name} ${opt.limit ? `<span class="text-brand-gold text-[10px] ml-1 lowercase">(Max ${opt.limit})</span>` : ''}</span>
                            <span class="text-[10px] text-brand-gold block font-semibold">+₹${opt.price}</span>
                        </div>
                        <div class="flex items-center gap-2 bg-black/50 border border-white/10 rounded px-2 py-1">
                            <button onclick="updateManualAddonQty(this, -1)" class="text-white/50 hover:text-brand-gold text-xs px-1">-</button>
                            <span class="text-white font-bold text-xs w-4 text-center manual-addon-qty" 
                                data-name="${opt.name}" data-price="${opt.price}" data-limit="${opt.limit || 0}">0</span>
                            <button onclick="updateManualAddonQty(this, 1)" class="text-white/50 hover:text-brand-gold text-xs px-1">+</button>
                        </div>
                    </div>
                `;
            });
            groupHtml += `
                    </div>
                </div>
            `;
            content.innerHTML += groupHtml;
        });
    }
    
    calculateManualCustTotal();
    
    const modal = document.getElementById('manual-customization-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
};

window.closeManualCustomizationModal = () => {
    const modal = document.getElementById('manual-customization-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.selectManualVariant = (radioEl) => {
    manualCustSelectedVariantPrice = Number(radioEl.getAttribute('data-variant-price'));
    document.querySelectorAll('#manual-cust-content input[name="manual-variant-choice"]').forEach(radio => {
        const label = radio.closest('label');
        if (label) {
            if (radio.checked) {
                label.className = "flex items-center justify-between border border-brand-gold bg-brand-gold/10 ring-1 ring-brand-gold rounded-2xl p-4 cursor-pointer transition-all relative";
            } else {
                label.className = "flex items-center justify-between border border-white/10 hover:bg-white/5 rounded-2xl p-4 cursor-pointer transition-all relative";
            }
        }
    });
    calculateManualCustTotal();
};

window.updateManualAddonQty = (btnEl, change) => {
    const qtySpan = btnEl.parentElement.querySelector('.manual-addon-qty');
    let qty = parseInt(qtySpan.innerText) || 0;

    if (change > 0) {
        const limit = parseInt(qtySpan.getAttribute('data-limit')) || 0;
        if (limit > 0) {
            if (qty + change > limit) {
                showToast(`You can only select up to ${limit} of this option.`, 'error');
                return;
            }
        }
    }

    qty += change;
    if (qty < 0) qty = 0;
    qtySpan.innerText = qty;
    
    const row = btnEl.closest('.border-white\\/10');
    if (row) {
        if (qty > 0) {
            row.classList.add('bg-brand-gold/10', 'border-brand-gold/50');
            row.classList.remove('hover:bg-white/5');
        } else {
            row.classList.remove('bg-brand-gold/10', 'border-brand-gold/50');
            row.classList.add('hover:bg-white/5');
        }
    }
    calculateManualCustTotal();
};

window.updateManualCustQty = (change) => {
    manualCustQty += change;
    if (manualCustQty < 1) manualCustQty = 1;
    document.getElementById('manual-cust-qty').innerText = manualCustQty;
    calculateManualCustTotal();
};

window.calculateManualCustTotal = () => {
    let basePrice = manualCustSelectedVariantPrice !== null ? manualCustSelectedVariantPrice : Number(manualCustItem.price);
    let addonsTotal = 0;
    document.querySelectorAll('.manual-addon-qty').forEach(span => {
        const qty = parseInt(span.innerText) || 0;
        const price = Number(span.getAttribute('data-price')) || 0;
        addonsTotal += qty * price;
    });
    const finalTotal = (basePrice + addonsTotal) * manualCustQty;
    document.getElementById('manual-cust-total').innerText = '₹' + finalTotal.toFixed(2);
    return finalTotal;
};

window.confirmManualCustomization = () => {
    const customizations = {};
    const addonDetails = [];
    let addonsCost = 0;
    
    let variantLabel = null;
    const selectedRadio = document.querySelector('input[name="manual-variant-choice"]:checked');
    if (selectedRadio) {
        variantLabel = selectedRadio.getAttribute('data-variant-label');
        customizations['Portion'] = variantLabel;
    }
    
    document.querySelectorAll('#manual-cust-content .cust-group:not(.variant-selection-group)').forEach(group => {
        const groupName = group.getAttribute('data-group-name');
        const activeSpans = Array.from(group.querySelectorAll('.manual-addon-qty')).filter(span => (parseInt(span.innerText) || 0) > 0);
        if (activeSpans.length > 0) {
            const choicesList = [];
            activeSpans.forEach(span => {
                const qty = parseInt(span.innerText);
                const name = span.getAttribute('data-name');
                const price = Number(span.getAttribute('data-price'));
                const display = qty > 1 ? `${name} (x${qty})` : name;
                choicesList.push(display);
                const totalCost = price * qty;
                addonsCost += totalCost;
                addonDetails.push({
                    name: display,
                    price: totalCost,
                    quantity: qty
                });
            });
            customizations[groupName] = choicesList.join(', ');
        }
    });
    
    const combinedUnitPrice = (manualCustSelectedVariantPrice !== null ? manualCustSelectedVariantPrice : Number(manualCustItem.price)) + addonsCost;
    
    manualCart.push({
        id: manualCustItem.id,
        name: manualCustItem.name,
        price: combinedUnitPrice,
        quantity: manualCustQty,
        customizations: customizations,
        addonDetails: addonDetails,
        image: manualCustItem.image || '',
        category: manualCustItem.category || '',
        isVeg: manualCustItem.isVeg || false,
        originalPrice: manualCustItem.originalPrice ? Number(manualCustItem.originalPrice) : null,
        variantLabel: variantLabel,
        quantityLabel: manualCustItem.quantityLabel || null
    });
    
    showToast(`Added ${manualCustItem.name} to order!`, "success");
    closeManualCustomizationModal();
    document.getElementById('manualMenuSelect').value = '';
    renderManualCart();
};

window.addManualItem = () => {
    const select = document.getElementById('manualMenuSelect');
    const itemId = select.value;
    if (!itemId) {
        showToast("Please select an item first.", "error");
        return;
    }

    const item = allMenu.find(i => i.id === itemId);
    if (!item) return;

    const hasVariants = item.variants && item.variants.length > 0;
    const hasCustomizations = item.customizations && item.customizations.length > 0;

    if (hasVariants || hasCustomizations) {
        openManualCustomizationModal(item);
    } else {
        const existing = manualCart.find(i => i.id === itemId && !i.variantLabel && (!i.customizations || Object.keys(i.customizations).length === 0));
        if (existing) {
            existing.quantity += 1;
        } else {
            manualCart.push({
                id: item.id,
                name: item.name,
                price: Number(item.price),
                quantity: 1,
                image: item.image || '',
                category: item.category || '',
                isVeg: item.isVeg || false,
                originalPrice: item.originalPrice ? Number(item.originalPrice) : null,
                variantLabel: null,
                quantityLabel: item.quantityLabel || null,
                customizations: {},
                addonDetails: []
            });
        }
        showToast(`Added ${item.name} to order!`, "success");
        select.value = "";
        renderManualCart();
    }
};

window.adjustManualQty = (index, change) => {
    manualCart[index].quantity += change;
    if (manualCart[index].quantity <= 0) {
        manualCart.splice(index, 1);
    }
    renderManualCart();
};

window.renderManualCart = () => {
    const container = document.getElementById('manual-cart-items');
    if (!container) return;

    if (manualCart.length === 0) {
        container.innerHTML = `<p class="text-white/30 text-xs italic text-center py-4">Cart is empty</p>`;
        updateManualTotals();
        return;
    }

    container.innerHTML = '';
    manualCart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        const customizationsList = item.customizations && Object.keys(item.customizations).length > 0
            ? Object.entries(item.customizations).map(([group, val]) => `${group}: ${val}`).join(' | ')
            : '';
        const customizationsHtml = customizationsList 
            ? `<p class="text-[9px] text-brand-gold/80 italic mt-0.5 truncate">${customizationsList}</p>` 
            : '';

        container.innerHTML += `
            <div class="flex items-center justify-between gap-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                <div class="flex-1 min-w-0">
                    <h4 class="text-xs font-bold text-white truncate">${item.name}</h4>
                    ${customizationsHtml}
                    <p class="text-[10px] text-white/50 mt-0.5">₹${item.price} x ${item.quantity}</p>
                </div>
                <div class="flex items-center gap-2 bg-black/50 border border-white/10 rounded px-2 py-1">
                    <button onclick="adjustManualQty(${index}, -1)" class="text-white/50 hover:text-brand-gold text-xs px-1">-</button>
                    <span class="text-white font-bold text-xs w-4 text-center">${item.quantity}</span>
                    <button onclick="adjustManualQty(${index}, 1)" class="text-white/50 hover:text-brand-gold text-xs px-1">+</button>
                </div>
                <div class="text-xs font-black text-brand-gold w-12 text-right">
                    ₹${itemTotal}
                </div>
            </div>
        `;
    });

    updateManualTotals();
};


window.updateManualTotals = () => {
    let subtotal = manualCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('manualSubtotal').innerText = '₹' + subtotal.toFixed(2);

    const type = document.getElementById('manualOrderType').value;
    let deliveryCharge = 0;
    
    if (type === 'delivery') {
        const dcInput = document.getElementById('manualDeliveryCharge').value;
        deliveryCharge = dcInput ? Number(dcInput) : 40;
    } else {
        document.getElementById('manualDeliveryCharge').value = 0;
    }
    
    const taxInput = document.getElementById('manualTax').value;
    const tax = taxInput ? Number(taxInput) : 0;

    const total = subtotal + deliveryCharge + tax;
    document.getElementById('manualTotal').innerText = '₹' + total.toFixed(2);
};

window.submitManualOrder = async () => {
    if (manualCart.length === 0) {
        showToast("Cart is empty!", "error");
        return;
    }

    const name = document.getElementById('manualCustName').value.trim();
    const phone = document.getElementById('manualCustPhone').value.trim();
    const address = document.getElementById('manualCustAddress').value.trim();
    const email = document.getElementById('manualCustEmail').value.trim();

    if (!name || !phone) {
        showToast("Customer Name and Phone are required.", "error");
        return;
    }

    const type = document.getElementById('manualOrderType').value;
    if (type === 'delivery' && !address) {
        showToast("Delivery Address is required for Delivery orders.", "error");
        return;
    }

    const btn = document.querySelector('button[onclick="submitManualOrder()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Processing...`;
    btn.disabled = true;

    try {
        const timestamp = new Date().toISOString();
        
        let orderNumber = null;
        try {
            const counterRef = doc(db, "counters", "orders");
            await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                if (!counterDoc.exists()) {
                    orderNumber = 1;
                    transaction.set(counterRef, { count: 1 });
                } else {
                    orderNumber = (counterDoc.data().count || 0) + 1;
                    transaction.update(counterRef, { count: orderNumber });
                }
            });
        } catch (counterError) {
            console.error("Counter error for manual order:", counterError);
            orderNumber = Math.floor(10000 + Math.random() * 90000); // Fallback
        }

        let subtotal = manualCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        let deliveryCharge = type === 'delivery' ? Number(document.getElementById('manualDeliveryCharge').value) : 0;
        let tax = Number(document.getElementById('manualTax').value);
        let total = subtotal + deliveryCharge + tax;

        const pm = document.getElementById('manualPaymentMethod').value;
        let pMethodStr = "Cash on Delivery";
        let pStatusStr = "Pending";
        let orderStatus = "Accepted";

        if (pm === 'online') {
            pMethodStr = "Online";
            pStatusStr = "Paid";
        } else if (pm === 'link') {
            pMethodStr = "Online (Payment Link)";
            pStatusStr = "Pending";
            orderStatus = "Pending";
        } else {
            pMethodStr = "COD";
            pStatusStr = "Pending";
        }

        const orderData = {
            userId: auth.currentUser ? auth.currentUser.uid : "manual_admin_order",
            name: name,
            customer: name, // Required for order details UI
            phone: phone,
            email: email || "manual@didisbiryani.in",
            address: address,
            items: manualCart,
            subtotal: subtotal,
            deliveryCharge: deliveryCharge,
            taxAmount: tax, // Renamed from tax to taxAmount to fix tamper warning
            discount: 0,
            donationAmount: 0,
            tipAmount: 0,
            walletAppliedAmount: 0,
            total: total,
            status: orderStatus,
            paymentMethod: pMethodStr,
            paymentStatus: pStatusStr,
            orderType: type,
            timestamp: timestamp,
            orderNumber: orderNumber,
            isManual: true
        };

        const docRef = await addDoc(collection(db, "orders"), orderData);

        // Send Telegram notification for manual orders too
        try {
            const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
            fetch('/api/send-telegram', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    orderNumber: orderData.orderNumber,
                    customerName: orderData.name,
                    phone: orderData.phone,
                    address: orderData.address,
                    items: orderData.items,
                    total: orderData.total,
                    paymentMethod: orderData.paymentMethod,
                    orderType: orderData.orderType,
                    isManual: true,
                    deliveryCharge: orderData.deliveryCharge,
                    taxAmount: orderData.taxAmount
                })
            }).catch(err => console.error('Telegram notification failed:', err));
        } catch(e) { console.error('Telegram error:', e); }

        showToast(`Manual Order #${orderNumber} placed successfully!`, "success");
        
        // Reset POS Form
        manualCart = [];
        document.getElementById('manualCustName').value = '';
        document.getElementById('manualCustPhone').value = '';
        document.getElementById('manualCustEmail').value = '';
        document.getElementById('manualCustAddress').value = '';
        document.getElementById('manualSearchPhone').value = '';
        document.getElementById('manualDeliveryCharge').value = '40';
        document.getElementById('manualTax').value = '10';
        document.getElementById('manualOrderType').value = 'delivery';
        document.getElementById('manualPaymentMethod').value = 'cod';
        renderManualCart();

        // Switch back to Dashboard to see the order
        switchTab('dashboard');

    } catch (e) {
        console.error("Error submitting manual order:", e);
        showToast("Error placing order. Check console.", "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        if(window.lucide) window.lucide.createIcons();
    }
};

// --- Global Push Notifications ---
document.addEventListener('DOMContentLoaded', () => {
    const broadcastForm = document.getElementById('broadcast-form');
    if (broadcastForm) {
        broadcastForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('broadcast-title').value.trim();
            const message = document.getElementById('broadcast-message').value.trim();
            if (!title || !message) return;

            const btn = document.getElementById('broadcast-submit-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Sending...';
            btn.disabled = true;
            if(window.lucide) window.lucide.createIcons();

            try {
                // Fetch all users
                const usersSnap = await getDocs(collection(db, "users"));
                const fcmTokens = [];
                usersSnap.forEach(doc => {
                    const data = doc.data();
                    if (data.fcmToken) fcmTokens.push(data.fcmToken);
                });

                if (fcmTokens.length === 0) {
                    showToast("No customers have registered for push notifications yet.", "error");
                    return;
                }

                const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
                const pushUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/send-push' : '/api/send-push';
                const res = await fetch(pushUrl, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({
                        tokens: fcmTokens,
                        title: title,
                        body: message,
                        data: { type: 'broadcast' }
                    })
                });

                if (!res.ok) throw new Error("Failed to send broadcast");
                
                showToast(`Successfully sent to ${fcmTokens.length} customers!`, "success");
                document.getElementById('broadcast-form').reset();

            } catch(err) {
                console.error("Broadcast Error:", err);
                showToast("Error sending broadcast notification.", "error");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                if(window.lucide) window.lucide.createIcons();
            }
        });
    }
});
