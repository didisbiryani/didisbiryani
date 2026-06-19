import { db, doc, onSnapshot, getDoc, collection, getDocs } from './firebase-config.js';

let allDeliveryBoys = [];
let trackingMap = null;
let customerMarker = null;
let restaurantMarker = null;
let driverMarker = null;
let driverUnsubscribe = null;
let RESTAURANT_LOCATION = { lat: 24.8333, lng: 92.7789 };

// Fetch store location
async function loadStoreLocation() {
    try {
        const snap = await getDoc(doc(db, "storeSettings", "info"));
        if (snap.exists() && snap.data().location) {
            RESTAURANT_LOCATION = snap.data().location;
        }
    } catch (err) {
        console.error("Error loading store location:", err);
    }
}

// Fetch delivery boys once
async function loadDeliveryBoys() {
    try {
        const snap = await getDocs(collection(db, "deliveryBoys"));
        snap.forEach(d => {
            allDeliveryBoys.push({ id: d.id, ...d.data() });
        });
    } catch (err) {
        console.error("Error loading delivery boys:", err);
    }
}

function safeFormatDate(timestamp) {
    if (!timestamp) return 'N/A';
    const dateObj = new Date(timestamp);
    if (isNaN(dateObj.getTime())) return 'N/A';
    return dateObj.toLocaleString('en-IN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

async function initTracking() {
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('orderId');

    if (!orderId) {
        showError("No order ID provided in the link.");
        return;
    }

    await Promise.all([loadDeliveryBoys(), loadStoreLocation()]);

    const orderRef = doc(db, "orders", orderId);
    
    // Listen to changes in real-time
    onSnapshot(orderRef, (docSnap) => {
        if (!docSnap.exists()) {
            showError("We couldn't find an order with this ID.");
            return;
        }

        const order = { id: docSnap.id, ...docSnap.data() };
        renderTracking(order);
    }, (error) => {
        console.error("Tracking listener error:", error);
        showError("Failed to connect to the tracking server.");
    });
}

function showError(msg) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('tracking-content').classList.add('hidden');
    
    const errorState = document.getElementById('error-state');
    errorState.classList.remove('hidden');
    errorState.classList.add('flex');
    
    document.getElementById('error-message').innerText = msg;
}

function initTrackingMap(order) {
    if (!window.google) return;
    const mapContainer = document.getElementById('tracking-map-container');
    if (!mapContainer) return;

    if (!trackingMap) {
        trackingMap = new google.maps.Map(mapContainer, {
            center: RESTAURANT_LOCATION,
            zoom: 14,
            disableDefaultUI: true,
            gestureHandling: 'greedy',
            fullscreenControl: true,
            styles: [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
            ]
        });

        // Restaurant Marker
        restaurantMarker = new google.maps.Marker({
            position: RESTAURANT_LOCATION,
            map: trackingMap,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: '#D4A017',
                fillOpacity: 1,
                strokeColor: '#000',
                strokeWeight: 2,
                scale: 8
            },
            title: "Restaurant"
        });
    }

    // Customer Marker
    if (order.location && order.location.lat && order.location.lng) {
        const custPos = { lat: order.location.lat, lng: order.location.lng };
        if (!customerMarker) {
            customerMarker = new google.maps.Marker({
                position: custPos,
                map: trackingMap,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: '#22c55e',
                    fillOpacity: 1,
                    strokeColor: '#000',
                    strokeWeight: 2,
                    scale: 8
                },
                title: "You"
            });
        } else {
            customerMarker.setPosition(custPos);
        }
        
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(RESTAURANT_LOCATION);
        bounds.extend(custPos);
        trackingMap.fitBounds(bounds, 50); // padding
    }

    // Handle Driver Live Location
    if (order.deliveryBoyId && ['Out for Delivery'].includes(order.status)) {
        if (driverUnsubscribe) return; // already listening
        driverUnsubscribe = onSnapshot(doc(db, "deliveryBoys", order.deliveryBoyId), (docSnap) => {
            if (docSnap.exists()) {
                const dbData = docSnap.data();
                if (dbData.liveLocation && dbData.liveLocation.lat) {
                    const driverPos = { lat: dbData.liveLocation.lat, lng: dbData.liveLocation.lng };
                    
                    if (!driverMarker) {
                        driverMarker = new google.maps.Marker({
                            position: driverPos,
                            map: trackingMap,
                            icon: {
                                url: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png', // Delivery bike icon
                                scaledSize: new google.maps.Size(40, 40),
                                anchor: new google.maps.Point(20, 20)
                            },
                            title: "Delivery Partner"
                        });
                    } else {
                        driverMarker.setPosition(driverPos);
                    }
                    
                    // Re-adjust bounds to keep driver and customer in view
                    if (customerMarker) {
                        const bounds = new google.maps.LatLngBounds();
                        bounds.extend(driverPos);
                        bounds.extend(customerMarker.getPosition());
                        trackingMap.fitBounds(bounds, 50);
                    }
                }
            }
        });
    } else {
        // If order delivered or cancelled, remove driver listener
        if (driverUnsubscribe) {
            driverUnsubscribe();
            driverUnsubscribe = null;
        }
        if (driverMarker) {
            driverMarker.setMap(null);
            driverMarker = null;
        }
    }
}

function renderTracking(order) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    
    const content = document.getElementById('tracking-content');
    content.classList.remove('hidden');
    content.classList.add('flex');
    
    initTrackingMap(order);

    const isPickup = order.orderType === 'pickup';
    
    // Delivery Boy details
    const dbCard = document.getElementById('delivery-boy-card');
    if (!isPickup && order.deliveryBoyId && ['Out for Delivery', 'Delivered'].includes(order.status)) {
        const boy = allDeliveryBoys.find(b => b.id === order.deliveryBoyId);
        if (boy) {
            document.getElementById('db-name').innerText = boy.name;
            document.getElementById('db-call-btn').href = `tel:${boy.phone}`;
            dbCard.classList.remove('hidden');
        } else {
            dbCard.classList.add('hidden');
        }
    } else {
        dbCard.classList.add('hidden');
    }

    // Update ETA and Hero
    const etaText = document.getElementById('eta-text');
    const statusHeadline = document.getElementById('status-headline');
    
    if (etaText && statusHeadline) {
        if (order.status === 'Rejected') {
            etaText.innerText = "Cancelled";
            etaText.classList.replace('text-brand-gold', 'text-brand-red');
            statusHeadline.innerText = "Order Cancelled by Restaurant";
        } else if (order.status === 'Delivered' || order.status === 'Collected') {
            etaText.innerText = "Completed";
            etaText.classList.replace('text-brand-gold', 'text-green-400');
            statusHeadline.innerText = `Successfully ${order.status}`;
        } else {
            etaText.classList.replace('text-brand-red', 'text-brand-gold');
            etaText.classList.replace('text-green-400', 'text-brand-gold');
            
            if (isPickup) {
                if(order.status === 'Pending') { etaText.innerText = "Awaiting"; statusHeadline.innerText = "Waiting for restaurant to accept"; }
                else if(order.status === 'Accepted') { etaText.innerText = "45 mins"; statusHeadline.innerText = "Restaurant accepted your order"; }
                else if(order.status === 'Cooking') { etaText.innerText = "30 mins"; statusHeadline.innerText = "Your food is being prepared"; }
                else if(order.status === 'Ready to Collect') { etaText.innerText = "Ready!"; statusHeadline.innerText = "Please collect from store"; }
            } else {
                if(order.status === 'Pending') { etaText.innerText = "Awaiting"; statusHeadline.innerText = "Waiting for restaurant to accept"; }
                else if(order.status === 'Accepted') { etaText.innerText = "45 mins"; statusHeadline.innerText = "Restaurant accepted your order"; }
                else if(order.status === 'Cooking') { etaText.innerText = "30 mins"; statusHeadline.innerText = "Your food is being prepared"; }
                else if(order.status === 'Ready for Delivery') { etaText.innerText = "Packing..."; statusHeadline.innerText = "Waiting for delivery partner"; }
                else if(order.status === 'Out for Delivery') { etaText.innerText = "10 mins"; statusHeadline.innerText = "Delivery partner is on the way!"; }
            }
        }
    }

    // Build Timeline
    const stages = isPickup ? 
        ['Pending', 'Accepted', 'Cooking', 'Ready to Collect', 'Collected'] : 
        ['Pending', 'Accepted', 'Cooking', 'Ready for Delivery', 'Out for Delivery', 'Delivered'];
    
    const descriptions = isPickup ? [
        "Order placed successfully",
        "Restaurant confirmed your order",
        "Chef is preparing your delicious food",
        "Food is packed and ready at the counter",
        "You have collected your order"
    ] : [
        "Order placed successfully",
        "Restaurant confirmed your order",
        "Chef is preparing your delicious food",
        "Food is packed and waiting for pickup",
        "Delivery partner has picked up your order",
        "Order delivered to your address"
    ];

    let currentStageIdx = stages.indexOf(order.status);
    if(order.status === 'Rejected') currentStageIdx = -1;

    const timelineContainer = document.getElementById('vertical-timeline');
    let timelineHtml = '';

    if (order.status === 'Rejected') {
        timelineHtml = `
            <div class="relative flex gap-4">
                <div class="flex flex-col items-center">
                    <div class="w-10 h-10 rounded-full bg-brand-red/20 border-2 border-brand-red flex items-center justify-center text-brand-red z-10">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </div>
                </div>
                <div class="pt-2 pb-6">
                    <h4 class="text-sm font-black text-brand-red uppercase tracking-wide">Order Cancelled</h4>
                    <p class="text-xs text-brand-white/50 mt-1">Reason: ${order.cancellationReason || 'No reason provided'}</p>
                </div>
            </div>
        `;
    } else {
        stages.forEach((stage, idx) => {
            const isCompleted = idx <= currentStageIdx;
            const isCurrent = idx === currentStageIdx;
            const isLast = idx === stages.length - 1;
            
            const iconColor = isCompleted ? 'text-brand-gold' : 'text-brand-white/20';
            const bgColor = isCompleted ? (isCurrent ? 'bg-brand-gold/20 shadow-[0_0_15px_rgba(212,160,23,0.3)] border-brand-gold' : 'bg-black border-brand-gold') : 'bg-black border-white/10';
            const titleColor = isCompleted ? 'text-brand-white' : 'text-brand-white/40';
            
            let iconName = 'circle';
            if (isCompleted) iconName = 'check-circle';
            if (isCurrent && stage === 'Cooking') iconName = 'flame';
            if (isCurrent && stage === 'Out for Delivery') iconName = 'bike';
            
            timelineHtml += `
                <div class="relative flex gap-4">
                    ${!isLast ? `
                        <!-- Line connecting to next -->
                        <div class="absolute left-5 top-10 bottom-[-10px] w-0.5 ${idx < currentStageIdx ? 'bg-brand-gold' : 'bg-white/10'} -ml-[1px]"></div>
                    ` : ''}
                    <div class="flex flex-col items-center">
                        <div class="w-10 h-10 rounded-full ${bgColor} border-2 flex items-center justify-center ${iconColor} z-10 transition-all duration-500">
                            <i data-lucide="${iconName}" class="w-5 h-5"></i>
                        </div>
                    </div>
                    <div class="pt-2 pb-6 flex-grow">
                        <h4 class="text-sm font-black ${titleColor} uppercase tracking-wide">${stage}</h4>
                        <p class="text-[11px] font-medium text-brand-white/50 mt-0.5">${descriptions[idx]}</p>
                    </div>
                </div>
            `;
        });
    }
    
    timelineContainer.innerHTML = timelineHtml;

    // Order Summary
    const orderNumStr = order.orderNumber ? String(order.orderNumber).padStart(5, '0') : order.id.substring(0,6).toUpperCase();
    document.getElementById('summary-order-id').innerText = orderNumStr;
    document.getElementById('summary-date').innerText = safeFormatDate(order.timestamp);
    document.getElementById('summary-total').innerText = `₹${Number(order.total).toFixed(2)}`;

    const itemsContainer = document.getElementById('summary-items');
    let itemsHtml = '';
    (order.items || []).forEach(i => {
        const custStr = i.customizations ? Object.values(i.customizations).join(', ') : '';
        itemsHtml += `
            <div class="flex justify-between items-start text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                <div class="max-w-[70%]">
                    <span class="text-brand-white/90 font-semibold">${i.name}</span>
                    ${i.variantLabel ? `<span class="text-brand-gold"> (${i.variantLabel})</span>` : ''}
                    <span class="text-brand-white/40 ml-1">x${i.quantity}</span>
                    ${custStr ? `<p class="text-[10px] text-brand-white/40 mt-0.5 italic">* ${custStr}</p>` : ''}
                </div>
                <span class="text-brand-white/90 font-bold">₹${(i.price * i.quantity).toFixed(2)}</span>
            </div>
        `;
    });
    itemsContainer.innerHTML = itemsHtml;

    // Re-initialize lucide icons
    if (window.lucide) {
        lucide.createIcons();
    }
}

// Start immediately
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTracking);
} else {
    initTracking();
}
