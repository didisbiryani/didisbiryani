import { db, collection, getDocs, onSnapshot, auth, onAuthStateChanged, signOut, doc, query, where, getDoc, updateDoc, setDoc } from './firebase-config.js';
import { expireUserWalletEntries } from './wallet-helper.js';

let allDeliveryBoys = [];
let currentStoreSettings = { address: "Udharbond, Main Market Road, Near Post Office, Silchar, Assam 788030" };
let lastCompletedCount = 0;
let userProfileUnsubscribe = null;

// --- Safe Date Formatting Helper ---
function safeFormatDate(timestamp, formatType = 'date') {
    if (!timestamp) return 'N/A';
    const dateObj = new Date(timestamp);
    if (isNaN(dateObj.getTime())) return 'N/A';
    if (formatType === 'datetime') {
        return dateObj.toLocaleString();
    }
    return dateObj.toLocaleDateString();
}

onSnapshot(collection(db, "deliveryBoys"), (snapshot) => {
    allDeliveryBoys = [];
    snapshot.forEach(docSnap => {
        allDeliveryBoys.push({ id: docSnap.id, ...docSnap.data() });
    });
    if (typeof renderUserOrders === 'function') renderUserOrders();
});

function updateLoyaltyProgress(completedCount) {
    const threshold = currentStoreSettings.loyaltyThreshold || 5;
    const reward = currentStoreSettings.loyaltyReward || 50;
    const isActive = currentStoreSettings.loyaltyActive !== false;
    
    // Update rule notice text
    const noticeEl = document.getElementById('loyalty-rule-notice');
    if (noticeEl) {
        if (isActive) {
            noticeEl.innerText = `Every ${threshold} completed orders unlocks ₹${reward} reward cash!`;
        } else {
            noticeEl.innerText = `Loyalty rewards are currently inactive.`;
        }
    }
    
    // Update completed orders count UI
    const completedOrdersEl = document.getElementById('completed-orders-count');
    if (completedOrdersEl) {
        completedOrdersEl.innerText = completedCount;
    }
    
    // Next Milestone display
    const currentMilestoneProgress = completedCount % threshold;
    const nextMilestoneOrders = threshold - currentMilestoneProgress;
    
    const nextMilestoneEl = document.getElementById('next-milestone-text');
    if (nextMilestoneEl) {
        nextMilestoneEl.innerText = `${nextMilestoneOrders} Order${nextMilestoneOrders !== 1 ? 's' : ''}`;
    }
    
    const progressBar = document.getElementById('milestone-progress');
    if (progressBar) {
        const pct = (currentMilestoneProgress / threshold) * 100;
        progressBar.style.width = `${pct}%`;
    }
}

onSnapshot(doc(db, "storeSettings", "info"), (docSnap) => {
    if (docSnap.exists()) {
        currentStoreSettings = docSnap.data();
        updateLoyaltyProgress(lastCompletedCount);
    }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    if (userProfileUnsubscribe) {
        userProfileUnsubscribe();
        userProfileUnsubscribe = null;
    }
    await signOut(auth);
    window.location.href = 'index.html';
});

let dashChatUnsubscribe = null;
let dashChatInitialLoad = true;

onAuthStateChanged(auth, (user) => {
    if (!user) {
        if (userProfileUnsubscribe) {
            userProfileUnsubscribe();
            userProfileUnsubscribe = null;
        }
        window.location.href = 'index.html';
        return;
    }

    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');
    const avatarEl = document.getElementById('user-avatar');
    
    nameEl.innerText = user.displayName || 'Foodie';
    emailEl.innerText = user.email;
    if(user.photoURL) avatarEl.src = user.photoURL;

    // Remove skeletons
    const nameSkel = document.getElementById('user-name-skeleton');
    if (nameSkel) nameSkel.remove();
    const emailSkel = document.getElementById('user-email-skeleton');
    if (emailSkel) emailSkel.remove();
    
    nameEl.classList.remove('hidden');
    emailEl.classList.remove('hidden');
    avatarEl.classList.remove('opacity-0');
    if (avatarEl.parentElement) avatarEl.parentElement.classList.remove('animate-pulse');

    // Load user orders
    loadUserOrders(user.uid);

    // Prune expired entries on load
    expireUserWalletEntries(user.uid);

    // Profile Settings & Wallet listener
    if (!userProfileUnsubscribe) {
        userProfileUnsubscribe = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
            if (docSnap.exists()) {
                const userData = docSnap.data();
                // Wallet balance
                const balance = Number(userData.walletBalance) || 0;
                document.getElementById('wallet-balance').innerText = `₹${balance.toFixed(2)}`;
                
                // Form inputs (only prefill if not currently focused to avoid messing up active typing)
                const nameInput = document.getElementById('settings-name');
                const phoneInput = document.getElementById('settings-phone');
                const addressInput = document.getElementById('settings-address');
                const cityInput = document.getElementById('settings-city');
                const zipInput = document.getElementById('settings-zip');
                
                if (nameInput && document.activeElement !== nameInput) {
                    nameInput.value = userData.name || user.displayName || '';
                }
                if (phoneInput && document.activeElement !== phoneInput) {
                    phoneInput.value = userData.phone || '';
                }
                
                // Update header display name
                if (userData.name) {
                    document.getElementById('user-name').innerText = userData.name;
                }
                if (addressInput && document.activeElement !== addressInput) {
                    addressInput.value = userData.addressLine || '';
                }
                if (cityInput && document.activeElement !== cityInput) {
                    cityInput.value = userData.city || '';
                }
                if (zipInput && document.activeElement !== zipInput) {
                    zipInput.value = userData.zip || '';
                }
            } else {
                document.getElementById('wallet-balance').innerText = `₹0.00`;
            }
        });

        // Listen to active wallet entries to display expiry warnings
        onSnapshot(query(collection(db, "users", user.uid, "walletEntries"), where("remainingAmount", ">", 0)), (snapshot) => {
            let soonestEntry = null;
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data.expiryDate && data.expiryDate !== 'never') {
                    if (!soonestEntry || data.expiryDate < soonestEntry.expiryDate) {
                        soonestEntry = data;
                    }
                }
            });
            
            const warningEl = document.getElementById('wallet-expiry-warning');
            const warningTextEl = document.getElementById('wallet-expiry-text');
            if (warningEl && warningTextEl) {
                if (soonestEntry) {
                    warningTextEl.innerText = `₹${soonestEntry.remainingAmount.toFixed(2)} expires on ${soonestEntry.expiryDate}`;
                    warningEl.classList.remove('hidden');
                    warningEl.classList.add('flex');
                } else {
                    warningEl.classList.add('hidden');
                    warningEl.classList.remove('flex');
                }
            }
        });
    }

    // Set up form submission handler once
    const profileForm = document.getElementById('profile-settings-form');
    if (profileForm && !profileForm.dataset.listenerAdded) {
        profileForm.dataset.listenerAdded = "true";
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('settings-name') ? document.getElementById('settings-name').value.trim() : '';
            const phone = document.getElementById('settings-phone').value.trim();
            const addressLine = document.getElementById('settings-address').value.trim();
            const city = document.getElementById('settings-city').value.trim();
            const zip = document.getElementById('settings-zip').value.trim();
            
            try {
                await setDoc(doc(db, "users", user.uid), {
                    name: name || user.displayName || 'Foodie',
                    email: user.email,
                    photo: user.photoURL || '',
                    phone,
                    addressLine,
                    city,
                    zip
                }, { merge: true });
                
                // Sync to local storage for checkout prefilling
                const fullAddressText = `${addressLine}, ${city}, Assam - ${zip}`;
                localStorage.setItem('didisLastAddress', fullAddressText);
                localStorage.setItem('didisLastPhone', phone);
                
                showToast("Profile settings saved and synced successfully!", "success");
            } catch (err) {
                console.error("Error saving profile settings:", err);
                showToast("Failed to save settings. Please try again.", "error");
            }
        });
    }
    
    // Background Chat Listener for Notifications
    if (!dashChatUnsubscribe) {
        dashChatInitialLoad = true;
        dashChatUnsubscribe = onSnapshot(collection(db, "messages"), (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.customerId === user.uid && data.sender === 'Admin' && !dashChatInitialLoad) {
                        try {
                            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                            audio.volume = 0.5;
                            audio.play();
                        } catch(e) {}
                        
                        // Show toast notification
                        if (typeof showToast === 'function') {
                            showToast("New message from Support! Go to Home > Chat.", "info");
                        } else {
                            alert("New message from Support! Go back to Home page to view it.");
                        }
                    }
                }
            });
            dashChatInitialLoad = false;
        });
    }
});

let myCurrentOrders = [];

window.renderUserOrders = function() {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = '';
    
    if (myCurrentOrders.length === 0) {
        container.innerHTML = `
            <div class="text-center py-20 bg-white/5 border border-white/10 rounded-3xl">
                <i data-lucide="shopping-bag" class="w-16 h-16 mx-auto text-brand-white/20 mb-4"></i>
                <p class="text-brand-white/50 text-lg mb-4">You haven't placed any orders yet.</p>
                <a href="index.html" class="px-6 py-3 bg-brand-gold text-brand-black font-bold rounded-full hover:bg-white transition-colors">Browse Menu</a>
            </div>
        `;
        if(window.lucide) lucide.createIcons();
        return;
    }

    // Sort descending
    const sortedOrders = [...myCurrentOrders].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sortedOrders.forEach(order => {
        container.innerHTML += createOrderCard(order);
    });

    if(window.lucide) lucide.createIcons();
};

function loadUserOrders(uid) {
    const q = query(collection(db, "orders"), where("userId", "==", uid));
    onSnapshot(q, (snapshot) => {
        myCurrentOrders = [];
        let completedCount = 0;
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            myCurrentOrders.push({ id: docSnap.id, ...data });
            if (data.status === 'Delivered' || data.status === 'Collected') {
                completedCount++;
            }
        });

        // Set global completed count and update loyalty progress
        lastCompletedCount = completedCount;
        updateLoyaltyProgress(completedCount);

        // Update Firestore completed orders count
        try {
            setDoc(doc(db, "users", uid), {
                completedOrdersCount: completedCount
            }, { merge: true });
        } catch (e) {
            console.error("Error updating completedOrdersCount in Firestore:", e);
        }

        if (typeof renderUserOrders === 'function') renderUserOrders();
    });
}

function createOrderCard(order) {
    const itemsHtml = order.items.map(i => {
        const custStr = i.customizations ? Object.values(i.customizations).join(', ') : '';
        return `
            <div class="flex justify-between items-center text-sm mb-2">
                <span class="text-brand-white/80">${i.name}${i.variantLabel ? ` <span class="text-brand-gold text-xs">— ${i.variantLabel}</span>` : ''} <span class="text-brand-gold text-xs px-1">x${i.quantity}</span></span>
                <span class="text-brand-white/80">₹${i.price * i.quantity}</span>
            </div>
            ${custStr ? `<p class="text-xs text-brand-white/40 mb-2">${custStr}</p>` : ''}
        `;
    }).join('');

    const date = safeFormatDate(order.timestamp, 'datetime');
    
    // Status visual timeline
    const isPickup = order.orderType === 'pickup';
    const stages = isPickup ? 
        ['Pending', 'Accepted', 'Cooking', 'Ready to Collect', 'Collected'] : 
        ['Pending', 'Accepted', 'Cooking', 'Ready for Delivery', 'Out for Delivery', 'Delivered'];
    
    let currentStageIdx = stages.indexOf(order.status);
    if(order.status === 'Rejected') currentStageIdx = -1;

    let timelineHtml = '';
    if(order.status !== 'Rejected') {
        timelineHtml = `<div class="flex items-center justify-between mt-6 pt-6 border-t border-white/10 relative">`;
        
        // Background line
        timelineHtml += `<div class="absolute top-[37px] left-8 right-8 h-1 bg-white/10 z-0 rounded-full"></div>`;
        
        // Progress line
        const progressWidth = currentStageIdx > 0 ? (currentStageIdx / (stages.length - 1)) * 100 : 0;
        timelineHtml += `<div class="absolute top-[37px] left-8 h-1 bg-brand-gold z-0 rounded-full transition-all duration-1000" style="width: calc(${progressWidth}% - 2rem);"></div>`;
        
        stages.forEach((stage, idx) => {
            const isCompleted = idx <= currentStageIdx;
            const isCurrent = idx === currentStageIdx;
            const icon = isCompleted ? 'check-circle' : 'circle';
            const color = isCompleted ? 'text-brand-gold' : 'text-white/20';
            const bg = isCurrent ? 'bg-brand-gold/20 shadow-[0_0_15px_rgba(212, 160, 23,0.5)]' : 'bg-brand-black';
            
            timelineHtml += `
                <div class="relative z-10 flex flex-col items-center gap-2">
                    <div class="w-8 h-8 rounded-full ${bg} flex items-center justify-center ${color} border-2 border-brand-black">
                        <i data-lucide="${icon}" class="w-5 h-5"></i>
                    </div>
                    <span class="text-[8px] md:text-[10px] uppercase font-bold ${isCompleted ? 'text-brand-white' : 'text-brand-white/40'} text-center w-12 md:w-16 mt-1 leading-[1.2] block">${stage}</span>
                </div>
            `;
        });
        timelineHtml += `</div>`;
    }

    let statusHeader = '';
    if(order.status === 'Rejected') {
        statusHeader = `<span class="bg-red-500/20 text-red-500 border border-red-500/50 px-3 py-1 rounded-full text-xs font-bold uppercase">Order Cancelled</span>`;
    } else if(order.status === 'Delivered' || order.status === 'Collected') {
        statusHeader = `<span class="bg-green-500/20 text-green-500 border border-green-500/50 px-3 py-1 rounded-full text-xs font-bold uppercase">${order.status === 'Collected' ? 'Collected Successfully' : 'Delivered Successfully'}</span>`;
    } else {
        // ETA Simulation
        let eta = "Awaiting Confirmation";
        if (isPickup) {
            if(order.status === 'Accepted') eta = "ETA: 45 mins";
            if(order.status === 'Cooking') eta = "ETA: 30 mins";
            if(order.status === 'Ready to Collect') eta = "Ready! Awaiting your arrival";
        } else {
            if(order.status === 'Accepted') eta = "ETA: 45 mins";
            if(order.status === 'Cooking') eta = "ETA: 30 mins";
            if(order.status === 'Ready for Delivery') eta = "Awaiting Driver";
            if(order.status === 'Out for Delivery') eta = "Arriving in 10 mins!";
        }
        
        statusHeader = `
            <div class="flex items-center gap-3">
                <span class="relative flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-gold opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-brand-gold"></span></span>
                <span class="text-brand-gold font-bold text-sm">${eta}</span>
            </div>
        `;
    }

    let rejectionMessageHtml = '';
    if (order.status === 'Rejected') {
        const reasonText = order.cancellationReason || "No cancellation reason provided by the restaurant.";
        rejectionMessageHtml = `
            <div class="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                <p class="text-sm font-bold text-red-400 mb-1">This order has been cancelled by the restaurant.</p>
                <p class="text-xs text-brand-gold font-bold mb-2">Reason: "${reasonText}"</p>
                <p class="text-xs text-brand-white/70">Your amount will be refunded in 7 business days to your original payment mode.</p>
            </div>
        `;
    }

    return `
        <div class="glass border border-white/10 rounded-3xl p-6 md:p-8">
            <div class="flex justify-between items-start mb-6">
                <div>
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 class="text-brand-white/60 text-xs font-bold uppercase">Order Placed</h3>
                        <span class="px-2 py-0.5 rounded text-[9px] font-black uppercase ${isPickup ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-brand-gold/20 text-brand-gold border border-brand-gold/40'}">${isPickup ? '🏪 Take-In' : '🚚 Delivery'}</span>
                        ${order.paymentMethod === 'Cash on Delivery' ? `<span class="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-green-500/20 text-green-400 border border-green-500/40">💵 COD</span>` : ''}
                    </div>
                    <p class="text-brand-white text-sm">${date}</p>
                    <p class="text-brand-gold text-xs font-bold mt-1">#${order.orderNumber ? String(order.orderNumber).padStart(5, '0') : 'ORD' + order.id.substring(0,6).toUpperCase()}</p>
                </div>
                <div class="text-right flex-shrink-0">
                    ${statusHeader}
                </div>
            </div>

            <div class="bg-black/30 rounded-2xl p-5 mb-4">
                ${itemsHtml}
                <div class="flex justify-between items-center mt-4 pt-4 border-t border-white/10">
                    <span class="text-brand-white/60 font-bold text-sm">Total Paid</span>
                    <span class="text-brand-gold font-black text-xl">₹${order.total}</span>
                </div>
            </div>

            <!-- restaurant, Address & Delivery Boy Details -->
            <div class="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-xs space-y-2.5 relative">
                <div class="flex justify-between items-center">
                    <span class="text-brand-white/50">restaurant</span>
                    <span class="text-brand-white font-medium">Didi's Biryani</span>
                </div>
                <div class="flex justify-between items-start gap-4">
                    <span class="text-brand-white/50 flex-shrink-0">Outlet Address</span>
                    <span class="text-brand-white/70 font-medium text-right max-w-[220px]">${currentStoreSettings.address}</span>
                </div>
                ${!isPickup ? `
                <div class="flex justify-between items-start gap-4 pt-2.5 border-t border-white/5">
                    <span class="text-brand-white/50 flex-shrink-0">Delivery Address</span>
                    <div class="text-right">
                        <span class="text-brand-white/90 font-medium max-w-[220px] block" id="address-display-${order.id}">${order.address}</span>
                        ${(order.status === 'Pending' || order.status === 'Accepted' || order.status === 'Cooking') ? `
                            <button onclick="promptEditAddress('${order.id}', '${(order.address || '').replace(/'/g, "\\'")}')" class="text-brand-gold hover:text-white underline mt-1 transition-colors text-[10px]">Edit Address</button>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
            </div>

            ${(() => {
                if (order.orderType !== 'pickup' && order.deliveryBoyId && ['Out for Delivery', 'Delivered'].includes(order.status)) {
                    const boy = allDeliveryBoys.find(b => b.id === order.deliveryBoyId);
                    if (boy) {
                        return `
                            <!-- Prominent Delivery Boy Details -->
                            <div class="mt-4 p-4 rounded-2xl bg-brand-gold/10 border border-brand-gold/20 flex justify-between items-center group transition-colors hover:bg-brand-gold/20">
                                <div class="flex items-center gap-4">
                                    <div class="w-12 h-12 rounded-full bg-brand-gold/20 flex items-center justify-center text-brand-gold shadow-lg shadow-brand-gold/10">
                                        <i data-lucide="bike" class="w-6 h-6"></i>
                                    </div>
                                    <div>
                                        <p class="text-[10px] text-brand-gold uppercase font-bold tracking-wider mb-0.5 opacity-80">Delivery Partner</p>
                                        <p class="text-lg font-black text-brand-white leading-tight">${boy.name}</p>
                                    </div>
                                </div>
                                <a href="tel:${boy.phone}" class="w-12 h-12 rounded-full bg-green-500 text-black flex items-center justify-center hover:bg-green-400 hover:scale-105 transition-all shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                                    <i data-lucide="phone" class="w-5 h-5 fill-current"></i>
                                </a>
                            </div>
                        `;
                    }
                }
                return '';
            })()}

            ${timelineHtml}
            ${rejectionMessageHtml}
            ${(() => {
                let reviewHtml = '';
                if (order.status === 'Delivered' || order.status === 'Collected') {
                    if (order.review) {
                        const stars = Array(5).fill(0).map((_, i) => 
                            `<i data-lucide="star" class="w-3 h-3 ${i < order.review.rating ? 'fill-brand-gold text-brand-gold' : 'text-white/20'}"></i>`
                        ).join('');
                        reviewHtml = `
                            <div class="mt-4 p-4 rounded-xl bg-brand-gold/5 border border-brand-gold/20">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-xs font-bold text-brand-gold">Your Review</span>
                                    <div class="flex gap-1">${stars}</div>
                                </div>
                                ${order.review.text ? `<p class="text-xs text-brand-white/70 italic">"${order.review.text}"</p>` : ''}
                            </div>
                        `;
                    } else {
                        reviewHtml = `
                            <div class="mt-4 flex justify-end">
                                <button onclick="openReviewModal('${order.id}')" class="px-4 py-2 bg-brand-gold/10 text-brand-gold border border-brand-gold/30 rounded-xl text-xs font-bold hover:bg-brand-gold hover:text-black transition-all flex items-center gap-2">
                                    <i data-lucide="star" class="w-3.5 h-3.5"></i> Rate Your Order
                                </button>
                            </div>
                        `;
                    }
                }
                return reviewHtml;
            })()}
            
            <!-- Action Buttons -->
            <div class="mt-4 flex flex-wrap gap-2 justify-end">
                ${['Delivered', 'Collected', 'Rejected'].includes(order.status) ? '' : `
                    <a href="tracking.html?orderId=${order.id}" class="px-4 py-2 bg-white/5 text-white border border-white/10 rounded-xl text-xs font-bold hover:bg-white/10 transition-all flex items-center gap-2">
                        <i data-lucide="map" class="w-3.5 h-3.5"></i> Track Order
                    </a>
                `}
                <button onclick="reorder('${order.id}')" class="px-4 py-2 bg-brand-gold text-black rounded-xl text-xs font-bold hover:bg-white transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(212,160,23,0.3)]">
                    <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Reorder
                </button>
            </div>
        </div>
    `;
}

window.promptEditAddress = async (orderId, currentAddress) => {
    const newAddress = prompt("Enter your new delivery address:", currentAddress);
    if (newAddress && newAddress.trim() !== "" && newAddress !== currentAddress) {
        try {
            await updateDoc(doc(db, "orders", orderId), {
                address: newAddress.trim()
            });
            showToast("Delivery address updated successfully!", "success");
        } catch (e) {
            console.error("Error updating address:", e);
            showToast("Failed to update address. Please try again.", "error");
        }
    }
};

window.reorder = (orderId) => {
    const order = myCurrentOrders.find(o => o.id === orderId);
    if (!order || !order.items) return;
    
    // Save to localStorage mimicking cart structure
    localStorage.setItem('didisCart', JSON.stringify(order.items));
    showToast("Items added to cart! Redirecting...", "success");
    
    // Redirect to home page where cart is automatically loaded
    setTimeout(() => {
        window.location.href = "index.html#checkout";
    }, 800);
};

// --- Review Logic ---
window.openReviewModal = (orderId) => {
    document.getElementById('review-order-id').value = orderId;
    document.getElementById('review-text').value = '';
    
    // Default 5 stars
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach(s => s.classList.replace('text-white/20', 'text-brand-gold'));
    document.getElementById('review-rating').value = 5;
    
    const modal = document.getElementById('review-modal');
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

window.closeReviewModal = () => {
    const modal = document.getElementById('review-modal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

// Star click handler
document.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const rating = parseInt(btn.getAttribute('data-val'));
        document.getElementById('review-rating').value = rating;
        
        document.querySelectorAll('.star-btn').forEach((s, i) => {
            if (i < rating) {
                s.classList.replace('text-white/20', 'text-brand-gold');
            } else {
                s.classList.replace('text-brand-gold', 'text-white/20');
            }
        });
    });
});

const reviewForm = document.getElementById('review-form');
if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const orderId = document.getElementById('review-order-id').value;
        const rating = parseInt(document.getElementById('review-rating').value) || 5;
        const text = document.getElementById('review-text').value.trim();
        const submitBtn = document.getElementById('submit-review-btn');
        
        if (!orderId) return;
        
        submitBtn.innerText = "Submitting...";
        submitBtn.disabled = true;
        
        try {
            await updateDoc(doc(db, "orders", orderId), {
                review: {
                    rating,
                    text,
                    timestamp: new Date().toISOString()
                }
            });
            showToast("Review submitted successfully! Thank you.", "success");
            window.closeReviewModal();
        } catch (error) {
            console.error("Error submitting review:", error);
            showToast("Failed to submit review.", "error");
        } finally {
            submitBtn.innerText = "Submit Review";
            submitBtn.disabled = false;
        }
    });
}
