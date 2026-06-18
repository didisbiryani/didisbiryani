import { db, auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, collection, getDocs, getDoc, onSnapshot, doc, updateDoc, query, where } from './firebase-config.js';
import { sendInvoiceEmail } from './email-helper.js';

// --- Safe Date Formatting Helper ---
function safeFormatDate(timestamp, formatType = 'date') {
    if (!timestamp) return 'N/A';
    const dateObj = new Date(timestamp);
    if (isNaN(dateObj.getTime())) return 'N/A';
    if (formatType === 'time') {
        return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return dateObj.toLocaleDateString();
}

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('delivery-login-form');
const loginError = document.getElementById('login-error');
const driverNameDisplay = document.getElementById('driver-name-display');
const ordersContainer = document.getElementById('orders-container');
const logoutBtn = document.getElementById('logout-btn');

// State
let loggedInDriver = null;
let activeOrders = [];
let activeDirectUpiOrderId = null;

// --- Silent Driver Auth ---
async function authenticateDriverService() {
    const email = 'driver@didisbiryani.in';
    const pass = 'dididrivers2024';
    
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        console.log("Driver service authenticated.");
    } catch (err) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
            try {
                await createUserWithEmailAndPassword(auth, email, pass);
                console.log("Driver service account created & authenticated.");
            } catch (createErr) {
                console.error("Failed to create driver account:", createErr);
            }
        } else {
            console.error("Driver auth failed:", err);
        }
    }
}
authenticateDriverService();
let currentStoreSettings = { address: "Udharbond, Main Market Road, Near Post Office, Silchar, Assam 788030", assignmentMode: "manual" };
let unsubscribeOrders = null;
let unsubscribeDriver = null;

// Siren & Alert State
let audioCtx = null;
let sirenOscillator = null;
let sirenGain = null;
let sirenInterval = null;
let previousPoolOrderIds = [];

// Initialize
function init() {
    // Fetch store settings for restaurant address
    onSnapshot(doc(db, "storeSettings", "info"), (docSnap) => {
        if (docSnap.exists()) {
            currentStoreSettings = docSnap.data();
            if (loggedInDriver) listenToOrders();
        }
    });

    // Check if already logged in
    const storedDriver = localStorage.getItem('didi_delivery_driver');
    if (storedDriver) {
        loggedInDriver = JSON.parse(storedDriver);
        showDashboard();
    }
}

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('login-phone').value.trim();
    const pin = document.getElementById('login-pin').value.trim();

    loginError.classList.add('hidden');

    try {
        // Query all delivery boys and trim locally to fix any trailing space issues
        const q = query(collection(db, "deliveryBoys"));
        const querySnapshot = await getDocs(q);

        let validDriver = null;
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const dbPhone = data.phone ? String(data.phone).trim() : '';
            const dbPin = data.passcode ? String(data.passcode).trim() : '';
            
            if (dbPhone === phone && dbPin === pin) {
                validDriver = { id: doc.id, name: data.name };
            }
        });

        if (validDriver) {
            loggedInDriver = validDriver;
            localStorage.setItem('didi_delivery_driver', JSON.stringify(loggedInDriver));
            showDashboard();
        } else {
            loginError.innerText = "Invalid phone number or PIN";
            loginError.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Login error:", err);
        loginError.innerText = "Connection error: " + err.message;
        loginError.classList.remove('hidden');
    }
});

// Logout
logoutBtn.addEventListener('click', async () => {
    if (loggedInDriver) {
        try {
            await updateDoc(doc(db, "deliveryBoys", loggedInDriver.id), { status: 'Offline' });
        } catch (e) {
            console.error("Error setting offline status on logout", e);
        }
    }
    localStorage.removeItem('didi_delivery_driver');
    loggedInDriver = null;
    if (unsubscribeOrders) {
        unsubscribeOrders();
        unsubscribeOrders = null;
    }
    stopSiren(); // Stop siren on logout
    if (unsubscribeDriver) {
        unsubscribeDriver();
        unsubscribeDriver = null;
    }
    dashboardScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    stopLocationTracking();
});

let locationWatchId = null;

function startLocationTracking() {
    if (locationWatchId) return;
    if (navigator.geolocation) {
        locationWatchId = navigator.geolocation.watchPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const heading = position.coords.heading;
                
                if (loggedInDriver && loggedInDriver.id) {
                    try {
                        await updateDoc(doc(db, "deliveryBoys", loggedInDriver.id), {
                            liveLocation: { lat, lng, heading, timestamp: new Date().toISOString() }
                        });
                    } catch (e) {
                        console.error("Error updating live location", e);
                    }
                }
            },
            (error) => console.error("Location tracking error:", error),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
    }
}

function stopLocationTracking() {
    if (locationWatchId && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

// Show Dashboard
function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');

    driverNameDisplay.innerText = loggedInDriver.name;

    // Listen to Driver Document for Status
    if (unsubscribeDriver) unsubscribeDriver();
    unsubscribeDriver = onSnapshot(doc(db, "deliveryBoys", loggedInDriver.id), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            loggedInDriver.status = data.status || 'Offline';
            localStorage.setItem('didi_delivery_driver', JSON.stringify(loggedInDriver));
            updateStatusUI();
            listenToOrders();
            listenToDriverAnalytics();
        }
    });
}

function updateStatusUI() {
    const statusText = document.getElementById('driver-status-text');
    const btnArrived = document.getElementById('btn-status-arrived');
    const btnDelivery = document.getElementById('btn-status-delivery');

    if (loggedInDriver.status === 'Available') {
        statusText.innerHTML = `<span class="text-green-500 text-xs">AVAILABLE AT restaurant</span>`;
        btnArrived.classList.add('bg-green-500', 'text-white');
        btnArrived.classList.remove('text-green-500');
        btnDelivery.classList.remove('bg-blue-500', 'text-white');
        btnDelivery.classList.add('text-blue-500');
    } else if (loggedInDriver.status === 'On Delivery') {
        statusText.innerHTML = `<span class="text-blue-500 text-xs">ON DELIVERY</span>`;
        btnDelivery.classList.add('bg-blue-500', 'text-white');
        btnDelivery.classList.remove('text-blue-500');
        btnArrived.classList.remove('bg-green-500', 'text-white');
        btnArrived.classList.add('text-green-500');
    } else {
        statusText.innerHTML = `<span class="text-white/50 text-xs">OFFLINE</span>`;
        btnArrived.classList.remove('bg-green-500', 'text-white');
        btnArrived.classList.add('text-green-500');
        btnDelivery.classList.remove('bg-blue-500', 'text-white');
        btnDelivery.classList.add('text-blue-500');
    }
    
    if (loggedInDriver.status !== 'Offline') {
        startLocationTracking();
    } else {
        stopLocationTracking();
    }
}

window.sendWhatsAppPaymentLink = (orderId, amount, phone) => {
    const paymentUrl = `https://didisbiryani.in/payment.html?orderId=${orderId}`;
    const text = `Hi! Please pay ₹${amount} for your order from Didi's Biryani using this secure link: \n\n${paymentUrl}`;
    
    // Extract numbers only
    let formattedPhone = phone ? String(phone).replace(/\D/g, '') : '';
    // If it's a 10 digit Indian number without country code, add 91
    if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

    if (formattedPhone) {
        window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
};

// Forces Android to open the payment page in the actual Chrome browser instead of the WebView
window.openPaymentPageExternal = (orderId) => {
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
        // This intent URL specifically tells Android to hand this over to a real browser
        const intentUrl = `intent://didisbiryani.in/payment.html?orderId=${orderId}#Intent;scheme=https;action=android.intent.action.VIEW;end;`;
        window.location.href = intentUrl;
        
        // Fallback if intent fails (e.g., if testing on PC instead of phone app)
        setTimeout(() => {
            window.open(`https://didisbiryani.in/payment.html?orderId=${orderId}`, '_blank');
        }, 1500);
    } else {
        // iOS (iPhone) or Desktop — directly open standard URL safely
        window.open(`https://didisbiryani.in/payment.html?orderId=${orderId}`, '_blank');
    }
};

window.setDriverStatus = async (status) => {
    try {
        stopSiren(); // Stop siren explicitly when clicking any top mark
        
        // Force an immediate UI refresh and re-listen to overcome identical DB writes deduplication
        if (loggedInDriver) {
            loggedInDriver.status = status;
            listenToOrders();
        }
        
        await updateDoc(doc(db, "deliveryBoys", loggedInDriver.id), { status });
    } catch (e) {
        console.error("Error updating status:", e);
        if (e.code === 'not-found') {
            alert("Your driver account was deleted by the Admin. Please log in again.");
            localStorage.removeItem('didi_delivery_driver');
            window.location.reload();
        } else {
            alert("Failed to update status. Please try again.");
        }
    }
};

// --- Live Route Map Logic ---
let routeMap = null;
let directionsService = null;
let directionsRenderer = null;
let deliveryMarker = null;
let liveLocationWatchId = null;

window.openDeliveryMap = (destLat, destLng) => {
    const modal = document.getElementById('delivery-map-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    if (!window.google) return;

    if (!routeMap) {
        routeMap = new google.maps.Map(document.getElementById('delivery-route-map'), {
            zoom: 14,
            disableDefaultUI: true,
            styles: [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
            ]
        });
        
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
            map: routeMap,
            suppressMarkers: false,
            polylineOptions: {
                strokeColor: '#D4A017',
                strokeWeight: 4
            }
        });
        
        deliveryMarker = new google.maps.Marker({
            map: routeMap,
            icon: {
                url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
            },
            title: "You are here"
        });
    }

    // Default origin is the restaurant
    let originLatLng = { lat: currentStoreSettings.location ? currentStoreSettings.location.lat : 24.8333, lng: currentStoreSettings.location ? currentStoreSettings.location.lng : 92.7789 };
    const destinationLatLng = { lat: destLat, lng: destLng };

    // Request directions
    const calcRoute = (start, end) => {
        directionsService.route({
            origin: start,
            destination: end,
            travelMode: 'DRIVING'
        }, (response, status) => {
            if (status === 'OK') {
                directionsRenderer.setDirections(response);
                const leg = response.routes[0].legs[0];
                document.getElementById('delivery-map-eta').innerText = leg.duration.text;
                document.getElementById('delivery-map-dist').innerText = leg.distance.text;
            }
        });
    };

    // Watch for live position to update route origin
    if (navigator.geolocation) {
        liveLocationWatchId = navigator.geolocation.watchPosition((pos) => {
            originLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            deliveryMarker.setPosition(originLatLng);
            calcRoute(originLatLng, destinationLatLng);
        }, (err) => {
            console.error("Error watching position", err);
            calcRoute(originLatLng, destinationLatLng);
        }, { enableHighAccuracy: true });
    } else {
        calcRoute(originLatLng, destinationLatLng);
    }
};

window.closeDeliveryMap = () => {
    const modal = document.getElementById('delivery-map-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    
    if (liveLocationWatchId && navigator.geolocation) {
        navigator.geolocation.clearWatch(liveLocationWatchId);
        liveLocationWatchId = null;
    }
};

let unsubscribeAnalytics = null;
function listenToDriverAnalytics() {
    if (unsubscribeAnalytics) unsubscribeAnalytics();

    // Query all delivered orders by this driver
    const q = query(collection(db, "orders"), where("deliveryBoyId", "==", loggedInDriver.id), where("status", "==", "Delivered"));
    unsubscribeAnalytics = onSnapshot(q, (snapshot) => {
        let todayDel = 0;
        let weekDel = 0;
        let tipToday = 0;
        let cashToday = 0;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfToday);
        startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay()); // Sunday start

        snapshot.forEach(doc => {
            const data = doc.data();
            const orderDate = new Date(data.deliveredAt || data.timestamp);

            if (orderDate >= startOfWeek) {
                weekDel++;
            }
            if (orderDate >= startOfToday) {
                todayDel++;
                const actTip = Number(data.donationAmount) || Number(data.tipAmount) || 0;
                if (actTip > 0) tipToday += actTip;
                const isCod = data.paymentMethod === 'Cash on Delivery' || data.paymentMethod === 'cod';
                if (isCod) {
                    const dueAmt = data.amountDue !== undefined ? Number(data.amountDue) : Number(data.total);
                    cashToday += dueAmt;
                }
            }
        });

        document.getElementById('stat-del-today').innerText = todayDel;
        document.getElementById('stat-del-week').innerText = weekDel;
        document.getElementById('stat-tip-today').innerText = tipToday;
        document.getElementById('stat-cash-today').innerText = cashToday;
    });
}

function listenToOrders() {
    if (unsubscribeOrders) unsubscribeOrders();

    // If auto mode and driver is available, query all unassigned cooking orders
    if (currentStoreSettings.assignmentMode === 'auto' && loggedInDriver.status === 'Available') {
        const q = query(collection(db, "orders"));
        unsubscribeOrders = onSnapshot(q, (snapshot) => {
            const orders = [];
            let newOrderIncoming = false;

            snapshot.forEach(doc => {
                const data = doc.data();
                if ((data.status === 'Ready for Delivery' || data.status === 'Out for Delivery') && !data.deliveryBoyId && data.orderType !== 'pickup') {
                    orders.push({ id: doc.id, ...data, isPoolOrder: true });
                    
                    if (!previousPoolOrderIds.includes(doc.id)) {
                        newOrderIncoming = true;
                    }
                }
            });
            
            previousPoolOrderIds = orders.map(o => o.id);
            if (newOrderIncoming) {
                startSiren();
            }

            orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            renderOrders(orders);
        });
    } else {
        // Normal mode (or if On Delivery): Listen to assigned orders
        const q = query(collection(db, "orders"), where("deliveryBoyId", "==", loggedInDriver.id));
        unsubscribeOrders = onSnapshot(q, (snapshot) => {
            const orders = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.status !== 'Delivered') {
                    orders.push({ id: doc.id, ...data, isPoolOrder: false });
                }
            });
            orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            renderOrders(orders);
        });
    }
}

function renderOrders(orders) {
    ordersContainer.innerHTML = '';

    if (orders.length === 0) {
        ordersContainer.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-brand-white/30 text-sm mt-20">
                <i data-lucide="check-circle" class="w-16 h-16 mb-4 opacity-50"></i>
                <p>No active deliveries right now!</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    orders.forEach(o => {
        const timeStr = safeFormatDate(o.timestamp, 'time');

        // Maps Links
        const pickupUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(currentStoreSettings.address)}`;
        let dropoffUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.address)}`;
        if (o.location && o.location.lat && o.location.lng) {
            dropoffUrl = `https://www.google.com/maps/dir/?api=1&destination=${o.location.lat},${o.location.lng}`;
        }
        const phoneUrl = `tel:${o.phone}`;

        let tipBadge = '';
        const actTip = Number(o.donationAmount) || Number(o.tipAmount) || 0;
        if (actTip > 0) {
            tipBadge = `<span class="px-2 py-1 bg-brand-gold/20 text-brand-gold text-[10px] font-bold rounded shadow-[0_0_10px_rgba(212, 160, 23,0.2)]">TIP: ₹${actTip}</span>`;
        }

        let paymentBadge = '';
        if (o.paymentMethod === 'Cash on Delivery' || o.paymentMethod === 'cod') {
            const dueAmt = o.amountDue !== undefined ? o.amountDue : o.total;
            paymentBadge = `<span class="px-2 py-1 bg-red-500/20 text-red-500 text-[10px] font-bold rounded">COLLECT ₹${dueAmt} CASH</span>`;
        } else {
            paymentBadge = `<span class="px-2 py-1 bg-green-500/20 text-green-500 text-[10px] font-bold rounded">PAID ONLINE</span>`;
        }

        let actionHtml = '';
        if (o.isPoolOrder) {
            actionHtml = `
                <div class="swipe-container mt-2" data-action="accept" data-order="${o.id}">
                    <div class="swipe-track-fill"></div>
                    <div class="swipe-text">Swipe to Accept Delivery</div>
                    <div class="swipe-thumb"><i data-lucide="chevron-right"></i></div>
                </div>
            `;
        } else {
            actionHtml = `
                <div class="swipe-container mt-2" data-action="deliver" data-order="${o.id}">
                    <div class="swipe-track-fill"></div>
                    <div class="swipe-text">Swipe to Mark Delivered</div>
                    <div class="swipe-thumb"><i data-lucide="chevron-right"></i></div>
                </div>
            `;
            
            if (o.paymentMethod === 'Cash on Delivery' || o.paymentMethod === 'cod') {
                const method = currentStoreSettings.deliveryPaymentMethod === 'direct_upi' ? 'direct_upi' : 'razorpay';
                const upiId = currentStoreSettings.deliveryUpiId || '';
                const dueAmt = o.amountDue !== undefined ? o.amountDue : o.total;

                if (method === 'direct_upi') {
                    actionHtml += `
                        <button onclick="openDirectUpiModal('${o.id}', ${dueAmt}, '${upiId}')" class="w-full mt-2 py-3 bg-[#3395FF] text-white font-bold text-sm rounded-xl shadow-[0_0_15px_rgba(51,149,255,0.3)] hover:bg-white hover:text-[#3395FF] transition-colors flex items-center justify-center gap-2">
                            <i data-lucide="qr-code" class="w-5 h-5"></i> Customer Pay via UPI QR
                        </button>
                    `;
                } else {
                    actionHtml += `
                        <button onclick="openPaymentPageExternal('${o.id}')" class="w-full mt-2 py-3 bg-[#3395FF] text-white font-bold text-sm rounded-xl shadow-[0_0_15px_rgba(51,149,255,0.3)] hover:bg-white hover:text-[#3395FF] transition-colors flex items-center justify-center gap-2">
                            <i data-lucide="qr-code" class="w-5 h-5"></i> Customer Pay Online (UPI/QR)
                        </button>
                    `;
                }

                actionHtml += `
                    <div class="mt-4 bg-brand-black/40 p-3 rounded-xl border border-white/5">
                        <label class="block text-[10px] text-brand-white/50 mb-1 uppercase tracking-wider font-bold">Send Payment Link (WhatsApp)</label>
                        <div class="flex gap-2">
                            <input type="tel" id="custom-wa-phone-${o.id}" value="${o.phone || ''}" placeholder="WhatsApp Number" class="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#25D366]">
                            <button onclick="sendWhatsAppPaymentLink('${o.id}', ${dueAmt}, document.getElementById('custom-wa-phone-${o.id}').value)" class="px-4 py-2 bg-[#25D366] text-white font-bold text-sm rounded-lg shadow-[0_0_15px_rgba(37,211,102,0.3)] hover:bg-white hover:text-[#25D366] transition-colors flex items-center justify-center">
                                <i data-lucide="send" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `;
            }
        }

        ordersContainer.innerHTML += `
            <div class="glass border border-white/10 rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h3 class="font-black text-brand-white text-lg">Order #${o.orderNumber ? String(o.orderNumber).padStart(5, '0') : o.id.substring(0, 6).toUpperCase()}</h3>
                        <p class="text-[10px] text-brand-white/50">${timeStr} • ${o.status}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        ${tipBadge}
                        ${paymentBadge}
                    </div>
                </div>
                
                <div class="space-y-4 mb-6">
                    <!-- Pickup -->
                    <div class="flex gap-3 relative">
                        <div class="w-8 h-8 rounded-full bg-brand-gold/20 flex items-center justify-center text-brand-gold flex-shrink-0 z-10 border border-brand-gold/30">
                            <i data-lucide="store" class="w-4 h-4"></i>
                        </div>
                        <div class="absolute top-8 left-4 w-px h-16 bg-white/10 z-0"></div>
                        <div class="flex-1">
                            <p class="text-[10px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Pickup From</p>
                            <p class="text-xs text-brand-white line-clamp-2 leading-relaxed">${currentStoreSettings.address}</p>
                            <a href="${pickupUrl}" target="_blank" class="text-[10px] text-brand-gold font-bold mt-1.5 inline-flex items-center gap-1 hover:underline">
                                <i data-lucide="navigation" class="w-3 h-3"></i> Navigate to Store
                            </a>
                        </div>
                    </div>
                    
                    <!-- Dropoff -->
                    <div class="flex gap-3">
                        <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 flex-shrink-0 z-10 border border-green-500/30">
                            <i data-lucide="map-pin" class="w-4 h-4"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-[10px] font-bold text-brand-white/50 uppercase tracking-widest mb-1">Deliver To</p>
                            <p class="font-bold text-brand-white text-sm mb-0.5">${o.customer}</p>
                            <p class="text-xs font-bold text-brand-gold mb-2 inline-flex items-center gap-1">
                                <i data-lucide="phone" class="w-3 h-3"></i> ${o.phone || 'No phone'}
                            </p>
                            <p class="text-xs text-brand-white line-clamp-2 leading-relaxed mb-2">${o.address}</p>
                            
                            <div class="flex gap-4">
                                <a href="${dropoffUrl}" target="_blank" class="text-[10px] text-brand-gold font-bold inline-flex items-center gap-1 hover:underline">
                                    <i data-lucide="external-link" class="w-3 h-3"></i> Open Maps App
                                </a>
                                ${(o.location && o.location.lat && o.location.lng) ? `
                                <button onclick="openDeliveryMap(${o.location.lat}, ${o.location.lng})" class="text-[10px] text-brand-gold font-bold inline-flex items-center gap-1 hover:underline">
                                    <i data-lucide="map" class="w-3 h-3"></i> View Live Route
                                </button>
                                ` : ''}
                                <a href="${phoneUrl}" class="text-[10px] text-brand-gold font-bold inline-flex items-center gap-1 hover:underline">
                                    <i data-lucide="phone" class="w-3 h-3"></i> Call Customer
                                </a>
                            </div>
                        </div>
                    </div>

                    <!-- Items Checklist -->
                    <div class="mt-4 pt-4 border-t border-white/10">
                        <p class="text-[10px] font-black text-brand-gold uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                            <i data-lucide="package-check" class="w-3.5 h-3.5"></i> Items Pick Checklist
                        </p>
                        <div class="space-y-2">
                            ${(o.items || []).map((item, idx) => {
            const customizations = item.customizations ? Object.values(item.customizations).join(', ') : '';
            return `
                                    <label class="flex items-start gap-3 bg-white/5 border border-white/5 rounded-xl p-3 cursor-pointer select-none hover:bg-white/10 transition-colors">
                                        <input type="checkbox" class="w-4 h-4 rounded border-white/20 text-brand-gold bg-transparent focus:ring-0 focus:ring-offset-0 mt-0.5" />
                                        <div class="flex-1 text-xs">
                                            <div class="font-bold text-brand-white flex justify-between">
                                                <span>${item.name}${item.variantLabel ? ` <span class="text-brand-gold font-normal">— ${item.variantLabel}</span>` : ''}</span>
                                                <span class="text-brand-gold font-extrabold">x${item.quantity}</span>
                                            </div>
                                            ${customizations ? `<p class="text-[10px] text-brand-white/40 mt-1">${customizations}</p>` : ''}
                                        </div>
                                    </label>
                                `;
        }).join('')}
                        </div>
                    </div>
                </div>
                
                ${actionHtml}
            </div>
        `;
    });

    if (window.lucide) lucide.createIcons();
    initSwipeButtons();
}

// Mark as Delivered
window.markAsDelivered = async (orderId, btnElement) => {
    stopSiren();
    
    // Show a loading state
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = `<span class="animate-pulse">Updating...</span>`;
    btnElement.disabled = true;

    try {
        await updateDoc(doc(db, "orders", orderId), {
            status: 'Delivered',
            deliveredAt: new Date().toISOString()
        });

        // Fetch order details to retrieve customer email and queue the email invoice
        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (orderSnap.exists()) {
            const orderData = { id: orderSnap.id, ...orderSnap.data() };
            sendInvoiceEmail(orderData);
        }
    } catch (e) {
        console.error("Error updating order status:", e);
        alert("Failed to update status. Check your connection.");
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
        if (window.lucide) lucide.createIcons();
    }
};

window.acceptOrder = async (orderId) => {
    stopSiren();
    try {
        await updateDoc(doc(db, "orders", orderId), {
            deliveryBoyId: loggedInDriver.id,
            status: 'Out for Delivery'
        });
        await setDriverStatus('On Delivery');
    } catch (e) {
        console.error("Error accepting order:", e);
        alert("Failed to accept order. Someone else might have taken it.");
    }
};

window.payViaRazorpay = (orderId, amount, customerName, phone, email) => {
    if (typeof Razorpay === 'undefined') {
        alert('Razorpay SDK failed to load. Please check your connection.');
        return;
    }

    const options = {
        "key": "rzp_live_Suhxp1cUZNzELt",
        "amount": Math.round(amount * 100),
        "currency": "INR",
        "name": "Didi's Biryani",
        "description": "Delivery Payment",
        "image": "https://images.unsplash.com/photo-1633948332857-e685f67b4585?q=80&w=150",
        "handler": async function (response) {
            try {
                await updateDoc(doc(db, "orders", orderId), {
                    paymentId: response.razorpay_payment_id,
                    paymentMethod: 'Online (Razorpay)'
                });
                alert("Payment Successful! You can now Mark as Delivered.");
            } catch (err) {
                console.error("Firebase Error: ", err);
                alert("Failed to update payment status: " + err.message + "\n\nPayment ID: " + response.razorpay_payment_id);
            }
        },
        "prefill": {
            "name": customerName,
            "email": email || "customer@example.com",
            "contact": phone || "9999999999",
            "method": "upi"
        },
        "config": {
            "display": {
                "hide": [
                    { "method": "card" },
                    { "method": "netbanking" },
                    { "method": "wallet" },
                    { "method": "emi" },
                    { "method": "paylater" }
                ],
                "preferences": {
                    "show_default_blocks": true
                }
            }
        },
        "theme": {
            "color": "#D4A017"
        }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response) {
        alert("Payment Failed: " + response.error.description);
    });
    rzp.open();
};


window.openDirectUpiModal = (orderId, amount, upiId) => {
    if (!upiId) {
        alert("Merchant UPI ID is not configured in Admin panel.");
        return;
    }
    activeDirectUpiOrderId = orderId;

    document.getElementById('direct-upi-modal').classList.remove('hidden');
    document.getElementById('direct-upi-modal').classList.add('flex');

    document.getElementById('upi-qr-amount').innerText = `₹${amount}`;

    // Generate UPI Intent URL
    const upiUrl = `upi://pay?pa=${upiId}&pn=DidisBiryani&am=${amount}&cu=INR`;

    // Use qrserver API to generate QR code image
    const qrImage = document.getElementById('upi-qr-image');
    const loading = document.getElementById('upi-qr-loading');

    qrImage.classList.add('hidden');
    loading.classList.remove('hidden');

    qrImage.onload = () => {
        loading.classList.add('hidden');
        qrImage.classList.remove('hidden');
    };
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUrl)}`;
};

window.closeDirectUpiModal = () => {
    activeDirectUpiOrderId = null;
    document.getElementById('direct-upi-modal').classList.add('hidden');
    document.getElementById('direct-upi-modal').classList.remove('flex');
};

document.getElementById('upi-confirm-btn')?.addEventListener('click', async () => {
    if (!activeDirectUpiOrderId) return;

    const btn = document.getElementById('upi-confirm-btn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span class="animate-pulse">Verifying...</span>`;
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "orders", activeDirectUpiOrderId), {
            paymentMethod: 'Online (Direct UPI)',
            paymentId: 'UPI_' + Date.now()
        });
        alert("Payment Confirmed! You can now Mark as Delivered.");
        closeDirectUpiModal();
    } catch (err) {
        console.error(err);
        alert("Failed to confirm payment.");
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
});

// Siren & Web Audio Logic
window.startSiren = function() {
    if (audioCtx && audioCtx.state === 'running' && sirenOscillator) return; // Already playing

    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.resume();
        
        sirenOscillator = audioCtx.createOscillator();
        sirenGain = audioCtx.createGain();
        
        sirenOscillator.type = 'square';
        sirenOscillator.connect(sirenGain);
        sirenGain.connect(audioCtx.destination);
        
        sirenGain.gain.value = 0.5; // Volume
        sirenOscillator.start();
        
        let isHigh = false;
        sirenInterval = setInterval(() => {
            if (sirenOscillator) {
                sirenOscillator.frequency.setValueAtTime(isHigh ? 600 : 800, audioCtx.currentTime);
            }
            isHigh = !isHigh;
            if (navigator.vibrate) navigator.vibrate([500, 500]); // Continuous vibration pattern
        }, 500);
        
        // Auto-stop siren after 3 seconds to avoid irritating the delivery driver
        setTimeout(() => {
            stopSiren();
        }, 3000);
    } catch (e) {
        console.error("Could not play siren:", e);
    }
};

window.stopSiren = function() {
    if (sirenOscillator) {
        try { 
            sirenOscillator.stop(); 
            sirenOscillator.disconnect();
        } catch(e) {}
        sirenOscillator = null;
    }
    if (sirenGain) {
        try { sirenGain.disconnect(); } catch(e) {}
        sirenGain = null;
    }
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
    }
    if (audioCtx && audioCtx.state === 'running') {
        try { audioCtx.suspend(); } catch(e) {}
    }
    try {
        if (navigator.vibrate) navigator.vibrate(0);
    } catch(e) {}
};

// Swipe Button Logic
window.initSwipeButtons = function() {
    const containers = document.querySelectorAll('.swipe-container');
    
    containers.forEach(container => {
        const thumb = container.querySelector('.swipe-thumb');
        const trackFill = container.querySelector('.swipe-track-fill');
        const text = container.querySelector('.swipe-text');
        
        let isDragging = false;
        let startX = 0;
        let thumbLeft = 0;
        const maxScroll = container.offsetWidth - thumb.offsetWidth - 8; // 4px padding each side

        function handleStart(clientX) {
            isDragging = true;
            startX = clientX;
            thumb.style.transition = 'none';
            trackFill.style.transition = 'none';
        }

        function handleMove(clientX) {
            if (!isDragging) return;
            let moveX = clientX - startX;
            thumbLeft = Math.max(0, Math.min(moveX, maxScroll));
            
            thumb.style.transform = `translateX(${thumbLeft}px)`;
            trackFill.style.width = `${thumbLeft + 24}px`;
            
            if (thumbLeft > maxScroll * 0.5) {
                text.style.opacity = '0';
            } else {
                text.style.opacity = '1';
            }
        }

        function handleEnd() {
            if (!isDragging) return;
            isDragging = false;
            thumb.style.transition = 'transform 0.3s ease';
            trackFill.style.transition = 'width 0.3s ease';
            
            if (thumbLeft >= maxScroll * 0.95) {
                // Success!
                thumb.style.transform = `translateX(${maxScroll}px)`;
                trackFill.style.width = '100%';
                container.classList.add('swipe-success');
                text.style.opacity = '1';
                text.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5 inline-block mr-1"></i> Done';
                if(window.lucide) lucide.createIcons();
                
                // Trigger action
                const action = container.getAttribute('data-action');
                const orderId = container.getAttribute('data-order');
                
                if (action === 'accept') {
                    acceptOrder(orderId);
                } else if (action === 'deliver') {
                    // Slight delay for visual feedback before confirm popup
                    setTimeout(() => markAsDelivered(orderId, container), 100);
                }
            } else {
                // Reset
                thumb.style.transform = 'translateX(0px)';
                trackFill.style.width = '0px';
                text.style.opacity = '1';
                thumbLeft = 0;
            }
        }

        // Touch events
        thumb.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX), {passive: true});
        document.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientX), {passive: true});
        document.addEventListener('touchend', handleEnd);
        
        // Mouse events for testing on desktop
        thumb.addEventListener('mousedown', (e) => handleStart(e.clientX));
        document.addEventListener('mousemove', (e) => handleMove(e.clientX));
        document.addEventListener('mouseup', handleEnd);
    });
};

// Ensure app refreshes live when coming back from background
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible' && loggedInDriver) {
        listenToOrders();
    }
});

init();
