import { db, auth, onAuthStateChanged, collection, onSnapshot, doc, updateDoc, query, where } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut } from './firebase-config.js';

// Admins only
const ADMIN_EMAILS = [
    'didisbiryani@gmail.com',
    'admin@gmail.com'
];

const loginOverlay = document.getElementById('admin-login-overlay');

onAuthStateChanged(auth, (user) => {
    if (!user) {
        loginOverlay.classList.remove('hidden');
    } else {
        if (ADMIN_EMAILS.includes(user.email)) {
            loginOverlay.classList.add('hidden');
            initKDS();
        } else {
            alert("Access Denied: Your email address does not have Admin privileges.");
            signOut(auth);
            loginOverlay.classList.remove('hidden');
        }
    }
});

// Login handlers
document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');

    if (!email || !password) {
        errorEl.innerText = "Please enter both email and password.";
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.showToast("Authenticated successfully!", "success");
    } catch (err) {
        console.error("Login failed", err);
        errorEl.innerText = "Login failed: " + err.message;
        errorEl.classList.remove('hidden');
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.reload();
});


// --- KDS State & Logic ---
let activeOrders = [];
let timeInterval = null;

function initKDS() {
    const ordersCol = collection(db, "orders");
    // We want orders that are in "Accepted" or "Cooking"
    const q = query(ordersCol, where("status", "in", ["Accepted", "Cooking"]));

    onSnapshot(q, (snapshot) => {
        activeOrders = [];
        snapshot.forEach(doc => {
            activeOrders.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort by oldest first (first in, first out for the kitchen)
        activeOrders.sort((a, b) => {
            const timeA = new Date(a.timestamp).getTime();
            const timeB = new Date(b.timestamp).getTime();
            return timeA - timeB;
        });

        renderKDS();
    });

    // Update elapsed timers every 10 seconds
    if (timeInterval) clearInterval(timeInterval);
    timeInterval = setInterval(updateElapsedTimes, 10000);
}

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

function getElapsedMinutes(timestamp) {
    if (!timestamp) return 0;
    const orderTime = new Date(timestamp).getTime();
    const now = new Date().getTime();
    return Math.floor((now - orderTime) / 60000); // return minutes
}

function renderKDS() {
    const grid = document.getElementById('kds-grid');
    const emptyState = document.getElementById('empty-state');

    if (activeOrders.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    
    let html = '';
    
    activeOrders.forEach(o => {
        const orderNum = o.orderNumber ? String(o.orderNumber).padStart(5, '0') : 'ORD' + o.id.substring(0, 6).toUpperCase();
        const elapsed = getElapsedMinutes(o.timestamp);
        
        // Color coding for time
        let timeColorClass = "text-green-400 bg-green-500/10 border-green-500/20";
        let cardBorderClass = "border-white/10";
        let isFlash = "";

        if (elapsed >= 30) {
            timeColorClass = "text-brand-red bg-brand-red/10 border-brand-red/20 font-black";
            cardBorderClass = "border-brand-red shadow-[0_0_15px_rgba(193,18,31,0.3)]";
            isFlash = "new-order-flash"; // Repurpose flash for very late orders
        } else if (elapsed >= 15) {
            timeColorClass = "text-brand-gold bg-brand-gold/10 border-brand-gold/20 font-bold";
            cardBorderClass = "border-brand-gold/50";
        }

        // New order flash (if under 1 minute)
        if (elapsed < 1 && o.status === "Accepted") {
            isFlash = "new-order-flash";
        }

        // Build Items List
        let itemsHtml = '';
        (o.items || []).forEach((item, index) => {
            const custStr = item.customizations ? Object.values(item.customizations).join(', ') : '';
            const variantStr = item.variantLabel ? item.variantLabel : '';
            
            // Collect addons
            let addonsHtml = '';
            if (item.addonDetails && item.addonDetails.length > 0) {
                addonsHtml = `<div class="mt-1 flex flex-wrap gap-1">`;
                item.addonDetails.forEach(a => {
                    addonsHtml += `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-gold/20 text-brand-gold border border-brand-gold/30">+ ${escapeHTML(a.name)}</span>`;
                });
                addonsHtml += `</div>`;
            }

            itemsHtml += `
                <div class="py-3 border-b border-white/5 last:border-0 flex items-start gap-3">
                    <div class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm font-black text-brand-white shrink-0 mt-0.5">
                        ${item.quantity}x
                    </div>
                    <div class="flex-1">
                        <div class="flex items-start justify-between gap-2">
                            <h4 class="text-base font-bold text-white leading-tight">${escapeHTML(item.name)}</h4>
                        </div>
                        ${variantStr ? `<p class="text-xs font-bold text-brand-gold mt-1">${escapeHTML(variantStr)}</p>` : ''}
                        ${custStr ? `<p class="text-xs font-bold text-brand-red uppercase tracking-wider mt-1 bg-brand-red/10 inline-block px-2 py-0.5 rounded">* ${escapeHTML(custStr)}</p>` : ''}
                        ${addonsHtml}
                    </div>
                </div>
            `;
        });

        const btnText = o.orderType === 'pickup' ? 'Ready to Collect' : 'Ready for Delivery';

        html += `
            <div class="bg-black/60 rounded-2xl flex flex-col overflow-hidden border ${cardBorderClass} ${isFlash} transition-all duration-500">
                <!-- Ticket Header -->
                <div class="bg-white/5 p-4 border-b border-white/10 flex justify-between items-center shrink-0">
                    <div>
                        <p class="text-[10px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Ticket #</p>
                        <h3 class="text-2xl font-black text-brand-gold tracking-tight">#${orderNum}</h3>
                    </div>
                    <div class="text-right flex flex-col items-end">
                        <span class="px-2.5 py-1 rounded-lg text-xs border ${timeColorClass} flex items-center gap-1.5" data-timestamp="${o.timestamp}" id="time-${o.id}">
                            <i data-lucide="clock" class="w-3 h-3"></i> 
                            <span class="elapsed-val">${elapsed}m</span>
                        </span>
                        <span class="text-[10px] font-bold uppercase mt-2 px-2 py-0.5 rounded bg-white/10 text-brand-white/70">
                            ${escapeHTML(o.orderType)}
                        </span>
                    </div>
                </div>
                
                <!-- Items list -->
                <div class="p-4 flex-1 bg-[#0a0a0a]">
                    ${itemsHtml}
                </div>

                <!-- Footer Action -->
                <div class="p-4 bg-white/5 border-t border-white/10 shrink-0">
                    <button onclick="window.markOrderReady('${o.id}', '${o.orderType}')" class="w-full py-4 bg-brand-gold text-brand-black rounded-xl font-black text-sm uppercase tracking-wider hover:bg-white transition-all shadow-[0_0_20px_rgba(212,160,23,0.3)] flex justify-center items-center gap-2">
                        <i data-lucide="check-circle" class="w-5 h-5"></i>
                        ${btnText}
                    </button>
                </div>
            </div>
        `;
    });

    grid.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

function updateElapsedTimes() {
    if (!activeOrders.length) return;
    
    activeOrders.forEach(o => {
        const elapsed = getElapsedMinutes(o.timestamp);
        const timeBadge = document.getElementById(`time-${o.id}`);
        if (timeBadge) {
            const valSpan = timeBadge.querySelector('.elapsed-val');
            if (valSpan) valSpan.innerText = `${elapsed}m`;
            
            // Re-render entirely if boundaries crossed to update colors
            if (elapsed === 15 || elapsed === 30 || elapsed === 1) {
                renderKDS(); 
            }
        }
    });
}

// Global action handler
window.markOrderReady = async (orderId, orderType) => {
    const newStatus = orderType === 'pickup' ? 'Ready to Collect' : 'Ready for Delivery';
    
    try {
        const orderRef = doc(db, "orders", orderId);
        await updateDoc(orderRef, {
            status: newStatus
        });
        
        window.showToast("Order marked as ready!", "success");
        // The onSnapshot will automatically re-render and remove it from the screen
    } catch (err) {
        console.error("Error updating order", err);
        window.showToast("Failed to update status", "error");
    }
};
