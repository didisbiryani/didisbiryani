import { db, collection, addDoc, auth, onAuthStateChanged, getDocs, getDoc, setDoc, query, where, onSnapshot, doc, runTransaction, increment } from './firebase-config.js';
import { expireUserWalletEntries, consumeWalletEntries } from './wallet-helper.js';

let cart = JSON.parse(localStorage.getItem('didisCart')) || [];
let currentUser = null;
let currentTotal = 0;
let donationAmount = 0;
let selectedPayment = 'card';
let deliveryCharge = 40;
let orderType = 'delivery';

// Telegram Order Notification (fire-and-forget, never blocks checkout)
async function sendTelegramNotification(orderData) {
    try {
        const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
        const telegramUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/send-telegram' : '/api/send-telegram';
        fetch(telegramUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                orderNumber: orderData.orderNumber,
                customerName: orderData.customer,
                phone: orderData.phone,
                address: orderData.address,
                items: orderData.items,
                total: orderData.total,
                paymentMethod: orderData.paymentMethod,
                orderType: orderData.orderType,
                deliveryCharge: orderData.deliveryCharge,
                taxAmount: orderData.taxAmount,
                discount: orderData.discount,
                walletApplied: orderData.walletApplied,
                amountDue: orderData.amountDue,
                donationAmount: orderData.donationAmount
            })
        }).catch(err => console.error('Telegram notification failed:', err));
    } catch (e) {
        console.error('Telegram notification error:', e);
    }
}
let currentStoreSettings = { deliveryCharge: 40, taxPercentage: 5, minOrderForFreeDelivery: 499, isOnline: true, storeMode: 'open' };

let addressText = '';
let phoneText = '';
let nameText = '';
let allMenu = [];

let userWalletBalance = 0;
let useWallet = false;
let walletAppliedAmount = 0;

window.toggleUseWallet = () => {
    const checkbox = document.getElementById('use-wallet-checkbox');
    useWallet = checkbox ? checkbox.checked : false;
    renderOrderSummary();
};

if (cart.length === 0) {
    window.location.href = 'index.html';
}

// Qty Adjustments inside cart feed
window.lastAttemptedRepeatCartIndex = null;

window.adjustQty = (index, change) => {
    if (change > 0 && cart[index].customizations && Object.keys(cart[index].customizations).length > 0) {
        window.lastAttemptedRepeatCartIndex = index;
        const modal = document.getElementById('repeat-customization-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            if (window.lucide) lucide.createIcons();
            return;
        }
    }

    cart[index].quantity += change;
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    }
    localStorage.setItem('didisCart', JSON.stringify(cart));

    if (cart.length === 0) {
        showToast("Cart is empty. Redirecting to home...", "error");
        setTimeout(() => window.location.href = 'index.html', 1500);
        return;
    }

    renderCheckoutItems();
    renderOrderSummary();
};

window.closeRepeatCustomizationModal = () => {
    const modal = document.getElementById('repeat-customization-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.confirmRepeatCustomization = () => {
    if (window.lastAttemptedRepeatCartIndex === null) return;
    const index = window.lastAttemptedRepeatCartIndex;
    cart[index].quantity += 1;
    localStorage.setItem('didisCart', JSON.stringify(cart));
    renderCheckoutItems();
    renderOrderSummary();
    closeRepeatCustomizationModal();
};

window.openNewCustomizationFromRepeat = () => {
    window.location.href = 'index.html#menu';
};

window.saveItemNote = (index, val) => {
    cart[index].note = val;
    localStorage.setItem('didisCart', JSON.stringify(cart));
};

// Render Cart items
function renderCheckoutItems() {
    const listContainer = document.getElementById('checkout-cart-items');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        const typeBadge = item.isVeg === 'true' || item.isVeg === true
            ? `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-green-600"><span class="w-1 h-1 rounded-full bg-green-600"></span></span>`
            : `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-red-600"><span class="w-1 h-1 rounded-full bg-red-600"></span></span>`;

        const custText = item.customizations && Object.keys(item.customizations).length > 0
            ? Object.entries(item.customizations).map(([gName, oVal]) => `${gName}: ${oVal}`).join(' | ')
            : '';

        listContainer.innerHTML += `
            <div class="py-4 flex flex-col gap-2 relative">
                <div class="flex items-start justify-between gap-4">
                    <div class="flex gap-3">
                        <div class="mt-1 flex-shrink-0">${typeBadge}</div>
                        <img src="${item.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=150'}" class="w-12 h-12 object-cover rounded-xl border border-white/10 flex-shrink-0">
                        <div>
                            <h4 class="text-xs font-black text-brand-white">${item.name}${item.variantLabel ? ` <span class="text-brand-gold font-normal">— ${item.variantLabel}</span>` : ''}</h4>
                            ${item.quantityLabel ? `<p class="text-[9px] text-brand-gold/70 font-bold mt-0.5">${item.quantityLabel}</p>` : ''}
                            ${custText ? `<p class="text-[9px] text-brand-white/40 mt-0.5">${custText}</p>` : ''}
                            <p class="text-[10px] text-brand-white/40 mt-0.5">₹${item.price} each</p>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-3">
                        <div class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                            <button onclick="adjustQty(${index}, -1)" class="text-brand-white/50 hover:text-brand-gold text-xs font-black px-1">-</button>
                            <span class="text-brand-white font-bold text-xs w-4 text-center">${item.quantity}</span>
                            <button onclick="adjustQty(${index}, 1)" class="text-brand-white/50 hover:text-brand-gold text-xs font-black px-1">+</button>
                        </div>
                        <div class="text-xs font-black text-brand-white w-14 text-right">₹${itemTotal}</div>
                    </div>
                </div>
                
                <textarea placeholder="Add a note (e.g., make it extra spicy, less oil)..." 
                    oninput="saveItemNote(${index}, this.value)" 
                    class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-[10px] text-brand-white/70 focus:outline-none focus:border-brand-gold transition-colors mt-2"
                >${item.note || ''}</textarea>
            </div>
        `;
    });
}

// Cross-Sell Recommendations and Live Price Sync
async function loadCrossSellItems() {
    try {
        onSnapshot(collection(db, "menu"), (querySnapshot) => {
            allMenu = [];
            querySnapshot.forEach(docSnap => {
                const item = docSnap.data();
                const status = item.status || (item.isAvailable === false ? 'Offline' : 'Available');
                if (status === 'Available') {
                    item.id = docSnap.id;
                    allMenu.push(item);
                }
            });
            // Self-heal cart items with missing properties (like isVeg) AND sync live prices from database
            let cartUpdated = false;
            cart.forEach(cartItem => {
                const menuItem = allMenu.find(m => m.id === cartItem.id || m.name === cartItem.name);
                if (menuItem) {
                    if (cartItem.isVeg === undefined) {
                        cartItem.isVeg = menuItem.isVeg;
                        cartUpdated = true;
                    }

                    const hasVariants = cartItem.variantLabel && cartItem.variantLabel !== '';
                    const hasCustomizations = cartItem.customizations && Object.keys(cartItem.customizations).length > 0;

                    if (!hasVariants && !hasCustomizations) {
                        if (cartItem.price !== menuItem.price) {
                            cartItem.price = menuItem.price;
                            cartUpdated = true;
                        }
                    }
                }
            });
            if (cartUpdated) {
                localStorage.setItem('didisCart', JSON.stringify(cart));
                renderCheckoutItems();
                calculateTotals();
            }

            renderCrossSellCarousel();
        });
    } catch (e) {
        console.error("Error loading cross-sell items", e);
    }
}

function renderCrossSellCarousel() {
    const carousel = document.getElementById('cross-sell-carousel');
    if (!carousel) return;

    let items = allMenu.filter(item => {
        const cat = (item.category || '').toLowerCase();
        return cat.includes('drink') || cat.includes('beverage') || cat.includes('starter') || cat.includes('side') || cat.includes('dessert');
    });

    if (items.length === 0) {
        items = allMenu.slice(0, 5);
    }

    carousel.innerHTML = '';
    items.forEach(item => {
        carousel.innerHTML += `
            <div class="flex-shrink-0 w-28 bg-[#1a1a1a] border border-white/5 rounded-2xl p-2 flex flex-col group relative">
                <div class="relative w-full h-16 rounded-xl overflow-hidden bg-black/25 mb-1.5">
                    <img src="${item.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=150'}" class="w-full h-full object-cover">
                    <button onclick="addCrossSellItem('${item.id}')" class="absolute bottom-1 right-1 w-6 h-6 bg-brand-gold text-brand-black rounded-full flex items-center justify-center hover:bg-white hover:scale-110 active:scale-95 transition-all shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
                        <i data-lucide="plus" class="w-3.5 h-3.5 stroke-[3.5]"></i>
                    </button>
                </div>
                <h5 class="text-[9px] font-black text-brand-white truncate">${item.name}</h5>
                <p class="text-[10px] font-black text-brand-gold mt-0.5">₹${item.price}</p>
            </div>
        `;
    });
    if (window.lucide) window.lucide.createIcons();
}

window.addCrossSellItem = (itemId) => {
    const item = allMenu.find(i => i.id === itemId);
    if (!item) return;

    const existing = cart.find(i => i.id === itemId);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            id: item.id,
            name: item.name,
            price: Number(item.price),
            quantity: 1,
            image: item.image,
            category: item.category,
            customizations: {},
            isVeg: item.isVeg,
            originalPrice: item.originalPrice ? Number(item.originalPrice) : null
        });
    }

    localStorage.setItem('didisCart', JSON.stringify(cart));
    showToast(`Added ${item.name} to order!`, "success");

    renderCheckoutItems();
    renderOrderSummary();
};

// Coupons Drawer list
let couponsList = [];
async function loadCouponsForDrawer() {
    try {
        const q = query(collection(db, "coupons"), where("isActive", "==", true));
        const snapshot = await getDocs(q);
        couponsList = [];
        snapshot.forEach(docSnap => {
            couponsList.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderCouponsInDrawer();
    } catch (e) {
        console.error("Error loading coupons for drawer", e);
    }
}

function renderCouponsInDrawer() {
    const listContainer = document.getElementById('coupons-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    if (couponsList.length === 0) {
        listContainer.innerHTML = '<p class="text-xs text-brand-white/40 py-6 text-center">No active coupons available right now.</p>';
        return;
    }
    let subtotal = cart.reduce((s, i) => s + (i.price * i.quantity), 0);

    couponsList.forEach(coupon => {
        let discText = '';
        if (coupon.type === 'percent') discText = `${coupon.value}% OFF`;
        else if (coupon.type === 'fixed') discText = `₹${coupon.value} OFF`;
        else if (coupon.type === 'bogo') discText = `BUY 1 GET 1 FREE`;
        else if (coupon.type === 'free_delivery') discText = `FREE DELIVERY`;

        const minOrder = coupon.minOrder || 0;
        let isEligible = subtotal >= minOrder;
        let statusHtml = '';
        let buttonHtml = '';
        let cardClasses = 'p-4 rounded-2xl bg-white/5 border border-white/10 transition-all flex justify-between items-center gap-4';

        if (isEligible) {
            statusHtml = `<p class="text-[10px] text-green-400 mt-1 font-bold">Available for this order!</p>`;
            buttonHtml = `<button onclick="applyCouponInline('${coupon.id}')" class="px-3.5 py-1.5 bg-brand-gold text-black text-[10px] font-black rounded-lg uppercase tracking-wider hover:bg-white transition-colors shadow-[0_0_15px_rgba(212,160,23,0.3)]">Apply</button>`;
            cardClasses += ' hover:border-brand-gold/40';
        } else {
            let needed = minOrder - subtotal;
            statusHtml = `<p class="text-[10px] text-brand-red mt-1 font-bold">Add ₹${needed} more to unlock</p>`;
            buttonHtml = `<button disabled class="px-3.5 py-1.5 bg-white/5 text-white/30 text-[10px] font-black rounded-lg uppercase tracking-wider cursor-not-allowed">Locked</button>`;
            cardClasses += ' opacity-60 grayscale-[50%]';
        }

        listContainer.innerHTML += `
            <div class="${cardClasses}">
                <div class="min-w-0">
                    <span class="px-2 py-0.5 ${isEligible ? 'bg-brand-gold text-black' : 'bg-white/20 text-white/50'} rounded font-black text-[9px] uppercase tracking-wider">${coupon.code}</span>
                    <h4 class="text-xs font-black text-brand-white mt-2">${discText}</h4>
                    ${statusHtml}
                    <p class="text-[9px] text-brand-white/40 mt-1">Min. Order: ₹${minOrder}</p>
                </div>
                ${buttonHtml}
            </div>
        `;
    });
}

window.openCouponsDrawer = () => {
    const popup = document.getElementById('coupons-drawer');
    const container = document.getElementById('coupons-drawer-container');
    if (!popup || !container) return;

    popup.classList.remove('hidden');
    popup.classList.add('flex');
    setTimeout(() => {
        container.classList.remove('translate-y-full');
        container.classList.add('translate-y-0');
    }, 10);
};

window.closeCouponsDrawer = () => {
    const popup = document.getElementById('coupons-drawer');
    const container = document.getElementById('coupons-drawer-container');
    if (!popup || !container) return;

    container.classList.remove('translate-y-0');
    container.classList.add('translate-y-full');
    setTimeout(() => {
        popup.classList.add('hidden');
        popup.classList.remove('flex');
    }, 300);
};

window.applyCouponInline = (couponId) => {
    const coupon = couponsList.find(c => c.id === couponId);
    if (!coupon) return;

    let subtotal = cart.reduce((s, i) => s + (i.price * i.quantity), 0);
    if (subtotal < (coupon.minOrder || 0)) {
        showToast(`Minimum order of ₹${coupon.minOrder} required.`, "error");
        return;
    }

    localStorage.setItem('didisCouponData', JSON.stringify(coupon));
    localStorage.setItem('didisCoupon', coupon.code);
    localStorage.setItem('didisCouponType', coupon.type);

    let discountAmt = 0;
    if (coupon.type === 'percent') {
        discountAmt = Math.round(subtotal * (coupon.value / 100));
    } else if (coupon.type === 'fixed') {
        discountAmt = coupon.value;
    }

    localStorage.setItem('didisDiscount', discountAmt);
    showToast(`Coupon "${coupon.code}" applied!`, "success");

    closeCouponsDrawer();
    renderOrderSummary();
};

window.applyTypedCoupon = () => {
    const input = document.getElementById('coupon-code-input');
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    const coupon = couponsList.find(c => c.code === code);
    if (!coupon) {
        showToast("Invalid Coupon Code.", "error");
        return;
    }

    window.applyCouponInline(coupon.id);
    input.value = '';
};

window.removeCouponInline = () => {
    localStorage.removeItem('didisCoupon');
    localStorage.removeItem('didisCouponType');
    localStorage.removeItem('didisDiscount');
    localStorage.removeItem('didisCouponData');

    showToast("Coupon removed", "success");
    renderOrderSummary();
};

// Inline edits
let checkoutMap = null;

window.initCheckoutMap = () => {
    if (typeof google === 'undefined' || !google.maps || !google.maps.Map) {
        setTimeout(window.initCheckoutMap, 500);
        return;
    }

    if (checkoutMap) return; // Prevent double initialization

    const defaultLocation = (currentUser && currentUser.lat && currentUser.lng) ?
        { lat: Number(currentUser.lat), lng: Number(currentUser.lng) } :
        { lat: 24.8333, lng: 92.7789 }; // Silchar

    checkoutMap = new google.maps.Map(document.getElementById('checkout-map'), {
        center: defaultLocation,
        zoom: 15,
        disableDefaultUI: true,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] }
        ]
    });

    checkoutMap.addListener('dragend', () => {
        const center = checkoutMap.getCenter();
        document.getElementById('lat-input').value = center.lat();
        document.getElementById('lng-input').value = center.lng();

        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: center }, (results, status) => {
            if (status === "OK" && results[0]) {
                document.getElementById('address-input').value = results[0].formatted_address;
            }
        });
    });

    const input = document.getElementById('map-search-input');
    const searchBox = new google.maps.places.SearchBox(input);

    checkoutMap.addListener('bounds_changed', () => {
        searchBox.setBounds(checkoutMap.getBounds());
    });

    searchBox.addListener('places_changed', () => {
        const places = searchBox.getPlaces();
        if (places.length == 0) return;

        const bounds = new google.maps.LatLngBounds();
        places.forEach(place => {
            if (!place.geometry || !place.geometry.location) return;
            if (place.geometry.viewport) {
                bounds.union(place.geometry.viewport);
            } else {
                bounds.extend(place.geometry.location);
            }
        });
        checkoutMap.fitBounds(bounds);
        setTimeout(() => google.maps.event.trigger(checkoutMap, 'dragend'), 500);
    });

    // Get GPS location if no valid currentUser location is already set
    if (navigator.geolocation && (!currentUser || !currentUser.lat)) {
        navigator.geolocation.getCurrentPosition(position => {
            const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
            if (checkoutMap) {
                checkoutMap.setCenter(pos);
                setTimeout(() => google.maps.event.trigger(checkoutMap, 'dragend'), 500);
            }
        }, () => { }, { timeout: 5000 });
    }

    // Force a resize in case the container was initially hidden or didn't have layout
    setTimeout(() => {
        if (checkoutMap) google.maps.event.trigger(checkoutMap, 'resize');
    }, 500);
};

window.saveAddressInline = () => {
    const addr = document.getElementById('address-input').value.trim();
    const lat = document.getElementById('lat-input').value;
    const lng = document.getElementById('lng-input').value;

    if (!addr) {
        showToast("Please enter address details.", "error");
        return;
    }

    addressText = addr;
    localStorage.setItem('didisLastAddress', addressText);
    if (lat && lng) {
        localStorage.setItem('didisLat', lat);
        localStorage.setItem('didisLng', lng);
    }

    if (currentUser) {
        setDoc(doc(db, "users", currentUser.uid), {
            address: addressText,
            lat: lat ? Number(lat) : null,
            lng: lng ? Number(lng) : null
        }, { merge: true }).catch(e => console.error("Error saving address", e));
    }

    document.getElementById('header-subtitle').innerText = "35-40 mins to Home | " + addressText;

    showToast("Address saved!", "success");
    // Sync to user profile in Firestore
    if (currentUser) {
        setDoc(doc(db, "users", currentUser.uid), {
            address: addressText,
            addressLine: addr
        }, { merge: true }).catch(err => console.error("Error syncing address to profile:", err));
    }
};

window.toggleContactEdit = () => {
    const block = document.getElementById('contact-edit-block');
    if (block) block.classList.toggle('hidden');
};

window.saveContactInline = () => {
    const fname = document.getElementById('fname-input').value.trim();
    const lname = document.getElementById('lname-input').value.trim();
    const phone = document.getElementById('phone-input').value.trim();

    if (!fname || !phone) {
        showToast("First Name and Phone are required.", "error");
        return;
    }

    nameText = `${fname} ${lname}`;
    phoneText = phone;

    localStorage.setItem('didisLastPhone', phoneText);

    document.getElementById('display-contact').innerText = `${nameText}, ${phoneText}`;
    document.getElementById('contact-edit-block').classList.add('hidden');
    showToast("Contact details saved!", "success");

    // Sync to user profile in Firestore
    if (currentUser) {
        setDoc(doc(db, "users", currentUser.uid), {
            name: nameText,
            phone: phoneText
        }, { merge: true }).catch(err => console.error("Error syncing contact to profile:", err));
    }
};

// Donation
window.selectDonation = (amount) => {
    if (donationAmount === amount) {
        // Deselect current preset tip
        donationAmount = 0;
        document.querySelectorAll('.donation-btn').forEach(btn => {
            btn.className = "donation-btn border border-white/10 hover:border-brand-gold bg-white/5 rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
        });
        const statusEl = document.getElementById('donation-status');
        if (statusEl) {
            statusEl.classList.add('hidden');
            statusEl.classList.remove('flex');
        }
    } else {
        // Select new preset tip
        donationAmount = amount;

        document.querySelectorAll('.donation-btn').forEach(btn => {
            const btnAmt = Number(btn.getAttribute('data-amt'));
            if (btnAmt === amount) {
                btn.className = "donation-btn border border-brand-gold bg-brand-gold/10 ring-2 ring-brand-gold rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
            } else {
                btn.className = "donation-btn border border-white/10 hover:border-brand-gold bg-white/5 rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
            }
        });

        document.getElementById('custom-donation-input-block').classList.add('hidden');

        const statusEl = document.getElementById('donation-status');
        const amtEl = document.getElementById('applied-donation-amount');
        if (statusEl && amtEl) {
            statusEl.classList.remove('hidden');
            statusEl.classList.add('flex');
            amtEl.innerText = amount;
        }
    }

    renderOrderSummary();
};

window.toggleCustomDonation = () => {
    const isCustomActive = donationAmount > 0 && ![10, 20, 30].includes(donationAmount);

    if (isCustomActive) {
        // Deselect custom tip
        donationAmount = 0;
        document.querySelectorAll('.donation-btn').forEach(btn => {
            btn.className = "donation-btn border border-white/10 hover:border-brand-gold bg-white/5 rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
        });
        const statusEl = document.getElementById('donation-status');
        if (statusEl) {
            statusEl.classList.add('hidden');
            statusEl.classList.remove('flex');
        }
        const block = document.getElementById('custom-donation-input-block');
        if (block) block.classList.add('hidden');
        renderOrderSummary();
    } else {
        // Just toggle custom input block visibility
        document.querySelectorAll('.donation-btn').forEach(btn => {
            btn.className = "donation-btn border border-white/10 hover:border-brand-gold bg-white/5 rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
        });

        const block = document.getElementById('custom-donation-input-block');
        if (block) block.classList.toggle('hidden');
    }
};

window.applyCustomDonation = () => {
    const val = Number(document.getElementById('custom-donation-input').value);
    if (!val || val <= 0) {
        showToast("Please enter a valid tip amount.", "error");
        return;
    }
    if (val > 100) {
        showToast("Maximum tip allowed is ₹100", "error");
        return;
    }

    donationAmount = val;

    const customBtn = document.getElementById('custom-donation-trigger');
    if (customBtn) {
        customBtn.className = "donation-btn border border-brand-gold bg-brand-gold/10 ring-2 ring-brand-gold rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
    }

    const statusEl = document.getElementById('donation-status');
    const amtEl = document.getElementById('applied-donation-amount');
    if (statusEl && amtEl) {
        statusEl.classList.remove('hidden');
        statusEl.classList.add('flex');
        amtEl.innerText = val;
    }

    renderOrderSummary();
};

// Payment options
window.selectPaymentMethod = (type) => {
    selectedPayment = type;

    const codLabel = document.getElementById('pay-cod-label');
    const onlineLabel = document.getElementById('pay-online-label');

    if (type === 'cod') {
        if (codLabel) {
            codLabel.className = "border border-brand-gold rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/10 ring-2 ring-brand-gold transition-all relative";
        }
        if (onlineLabel) {
            onlineLabel.className = "border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/5 hover:border-brand-gold transition-all relative";
        }
        document.getElementById('sticky-payment-info').innerText = "Pay via Cash on Delivery";
    } else {
        if (onlineLabel) {
            onlineLabel.className = "border border-brand-gold rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/10 ring-2 ring-brand-gold transition-all relative";
        }
        if (codLabel) {
            codLabel.className = "border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/5 hover:border-brand-gold transition-all relative";
        }
        document.getElementById('sticky-payment-info').innerText = "Pay via Online Card/UPI";
    }
};

// Order Type Selection
window.selectOrderType = (type) => {
    orderType = type;

    const deliveryLabel = document.getElementById('type-delivery-label');
    const pickupLabel = document.getElementById('type-pickup-label');
    const deliveryAddressBlock = document.getElementById('delivery-address-block');
    const deliverySectionTitle = document.getElementById('delivery-section-title');
    const tippingSec = document.getElementById('tipping-section');

    if (type === 'delivery') {
        if (deliveryLabel) {
            deliveryLabel.className = "border border-brand-gold rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/10 ring-2 ring-brand-gold transition-all relative";
        }
        if (pickupLabel) {
            pickupLabel.className = "border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/5 hover:border-brand-gold transition-all relative";
        }
        if (deliveryAddressBlock) {
            deliveryAddressBlock.classList.remove('hidden');
        }
        if (deliverySectionTitle) {
            deliverySectionTitle.innerText = "Delivery Details";
        }
        if (tippingSec) {
            tippingSec.classList.remove('hidden');
        }
    } else {
        if (pickupLabel) {
            pickupLabel.className = "border border-brand-gold rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/10 ring-2 ring-brand-gold transition-all relative";
        }
        if (deliveryLabel) {
            deliveryLabel.className = "border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/5 hover:border-brand-gold transition-all relative";
        }
        if (deliveryAddressBlock) {
            deliveryAddressBlock.classList.add('hidden');
        }
        if (deliverySectionTitle) {
            deliverySectionTitle.innerText = "Contact Details";
        }
        if (tippingSec) {
            tippingSec.classList.add('hidden');
            // Reset tipping when pickup is selected
            donationAmount = 0;
            document.querySelectorAll('.donation-btn').forEach(btn => {
                btn.className = "donation-btn border border-white/10 hover:border-brand-gold bg-white/5 rounded-xl py-2.5 text-xs font-black text-brand-white transition-colors";
            });
            const statusEl = document.getElementById('donation-status');
            if (statusEl) {
                statusEl.classList.add('hidden');
                statusEl.classList.remove('flex');
            }
        }
    }

    renderOrderSummary();
};

// Order Summary & calculations
function renderOrderSummary() {
    let subtotal = 0;
    let originalCartValue = 0;
    let baseItemsTotal = 0;
    let addonsHtml = '';

    cart.forEach(item => {
        let itemBasePrice = item.price;
        let itemAddons = 0;

        if (item.addonDetails && item.addonDetails.length > 0) {
            item.addonDetails.forEach(ad => {
                itemAddons += ad.price;
                const adTotal = ad.price * item.quantity;
                addonsHtml += `
                    <div class="flex justify-between items-center text-[10px] text-brand-white/50 pl-2">
                        <span>└ ${item.name} Add-On: ${ad.name} ${item.quantity > 1 ? `(x${item.quantity})` : ''}</span>
                        <span>₹${adTotal.toFixed(2)}</span>
                    </div>
                `;
            });
        }
        itemBasePrice -= itemAddons;

        subtotal += (item.price * item.quantity);
        let orig = item.originalPrice ? item.originalPrice : itemBasePrice;
        originalCartValue += ((orig + itemAddons) * item.quantity);
        baseItemsTotal += (itemBasePrice * item.quantity);
    });

    let storeDiscount = originalCartValue - subtotal;

    // Auto-invalidate coupon if cart drops below min requirement
    const couponDataStr = localStorage.getItem('didisCouponData');
    if (couponDataStr) {
        try {
            const couponData = JSON.parse(couponDataStr);
            if (couponData.minOrder && subtotal < Number(couponData.minOrder)) {
                localStorage.removeItem('didisCoupon');
                localStorage.removeItem('didisCouponType');
                localStorage.removeItem('didisCouponData');
                localStorage.setItem('didisDiscount', '0');

                // Clear UI elements
                const pTag = document.getElementById('applied-promo-tag');
                if (pTag) {
                    pTag.classList.add('hidden');
                    pTag.classList.remove('flex');
                }
                const pInput = document.getElementById('coupon-code-input');
                if (pInput) pInput.value = '';

                showToast(`Coupon removed! Cart must be ₹${couponData.minOrder}+`, "error");

                setTimeout(() => renderOrderSummary(), 50);
                return;
            }
        } catch (e) {
            console.error("Error parsing coupon data", e);
        }
    }

    const couponType = localStorage.getItem('didisCouponType') || '';

    let distanceStr = '';

    if (orderType === 'pickup') {
        deliveryCharge = 0;
        document.getElementById('summary-delivery-charge').innerText = 'Free (Take-in)';
    } else if (couponType === 'free_delivery' || subtotal >= (currentStoreSettings.minOrderForFreeDelivery || 499)) {
        deliveryCharge = 0;
        document.getElementById('summary-delivery-charge').innerText = subtotal >= (currentStoreSettings.minOrderForFreeDelivery || 499) ? 'Free (Threshold)' : 'Free (Coupon)';
    } else {
        const currentZip = document.getElementById('zip-input') ? document.getElementById('zip-input').value.trim() : '';
        const zones = currentStoreSettings.deliveryZones || [];
        const matchedZone = zones.find(z => z.zip === currentZip);

        if (matchedZone) {
            deliveryCharge = matchedZone.charge !== undefined ? Number(matchedZone.charge) : (currentStoreSettings.deliveryCharge !== undefined ? currentStoreSettings.deliveryCharge : 40);
            if (matchedZone.distance) {
                distanceStr = ` (${matchedZone.distance}km)`;
            }
        } else {
            deliveryCharge = currentStoreSettings.deliveryCharge !== undefined ? currentStoreSettings.deliveryCharge : 40;
        }
        document.getElementById('summary-delivery-charge').innerText = `₹${deliveryCharge.toFixed(2)}${distanceStr}`;
    }

    const discountAmt = Number(localStorage.getItem('didisDiscount')) || 0;

    // Dynamic Packing Charges calculation
    const taxAmt = currentStoreSettings.taxPercentage !== undefined ? Number(currentStoreSettings.taxPercentage) : 10;
    const taxLabel = document.getElementById('summary-tax-label');
    if (taxLabel) {
        taxLabel.innerText = `Packing Charges`;
    }
    const taxSpan = document.getElementById('summary-tax');
    if (taxSpan) {
        taxSpan.innerText = taxAmt.toFixed(2);
    }
    const subtotalEl = document.getElementById('summary-subtotal');
    if (subtotalEl) {
        subtotalEl.innerText = baseItemsTotal.toFixed(2);

        let addonsContainer = document.getElementById('summary-addons-container');
        if (!addonsContainer) {
            const subtotalRow = subtotalEl.closest('.flex');
            if (subtotalRow) {
                addonsContainer = document.createElement('div');
                addonsContainer.id = 'summary-addons-container';
                addonsContainer.className = 'space-y-1 mt-1';
                subtotalRow.parentNode.insertBefore(addonsContainer, subtotalRow.nextSibling);
            }
        }
        if (addonsContainer) {
            addonsContainer.innerHTML = addonsHtml;
            if (addonsHtml === '') {
                addonsContainer.classList.add('hidden');
            } else {
                addonsContainer.classList.remove('hidden');
            }
        }
    }

    const totalBeforeWallet = subtotal + deliveryCharge - discountAmt + donationAmount + taxAmt;

    if (useWallet && userWalletBalance > 0) {
        walletAppliedAmount = Math.min(totalBeforeWallet, userWalletBalance);
        currentTotal = totalBeforeWallet - walletAppliedAmount;

        const walletRow = document.getElementById('summary-wallet-row');
        if (walletRow) walletRow.classList.remove('hidden');
        const walletAmtEl = document.getElementById('summary-wallet-applied');
        if (walletAmtEl) walletAmtEl.innerText = walletAppliedAmount.toFixed(2);

        const walletMsg = document.getElementById('wallet-applied-message');
        if (walletMsg) {
            walletMsg.classList.remove('hidden');
            document.getElementById('wallet-applied-amount').innerText = walletAppliedAmount.toFixed(2);
        }
    } else {
        walletAppliedAmount = 0;
        currentTotal = totalBeforeWallet;

        const walletRow = document.getElementById('summary-wallet-row');
        if (walletRow) walletRow.classList.add('hidden');

        const walletMsg = document.getElementById('wallet-applied-message');
        if (walletMsg) walletMsg.classList.add('hidden');
    }

    // Detailed bill rows
    const origValSpan = document.getElementById('summary-original-value');
    if (origValSpan) origValSpan.innerText = originalCartValue.toFixed(2);

    const storeDiscRow = document.getElementById('summary-store-discount-row');
    if (storeDiscRow) {
        if (storeDiscount > 0) {
            storeDiscRow.classList.remove('hidden');
            document.getElementById('summary-store-discount').innerText = storeDiscount.toFixed(2);
        } else {
            storeDiscRow.classList.add('hidden');
        }
    }

    const discRow = document.getElementById('summary-discount-row');
    if (discountAmt > 0) {
        discRow.classList.remove('hidden');
        document.getElementById('summary-discount').innerText = discountAmt.toFixed(2);
    } else {
        discRow.classList.add('hidden');
    }

    const donRow = document.getElementById('summary-donation-row');
    if (donationAmount > 0) {
        donRow.classList.remove('hidden');
        document.getElementById('summary-donation').innerText = donationAmount.toFixed(2);
    } else {
        donRow.classList.add('hidden');
    }

    document.getElementById('summary-total').innerText = currentTotal.toFixed(2);

    // Sticky bottom bar
    document.getElementById('sticky-total').innerText = currentTotal.toFixed(2);

    // Sticky bottom bar info text
    if (currentTotal === 0 && walletAppliedAmount > 0) {
        document.getElementById('sticky-payment-info').innerText = "Fully Paid by Wallet Balance";
    } else {
        document.getElementById('sticky-payment-info').innerText = selectedPayment === 'cod' ? "Pay via Cash on Delivery" : "Pay via Online Card/UPI";
    }

    // Coupon box updates
    const couponText = document.getElementById('applied-coupon-text');
    const couponSub = document.getElementById('applied-coupon-subtext');
    const couponBtn = document.getElementById('coupon-action-btn');
    const savingsBanner = document.getElementById('savings-banner');
    const savingsAmt = document.getElementById('savings-amount');

    // Live update coupons drawer state
    if (typeof renderCouponsInDrawer === 'function') {
        renderCouponsInDrawer();
    }
    const couponCode = localStorage.getItem('didisCoupon') || '';

    if (couponCode) {
        if (couponText) couponText.innerText = `Coupon "${couponCode}" Applied!`;
        if (couponSub) couponSub.innerText = `You save ₹${discountAmt} with this coupon!`;
        if (couponBtn) {
            couponBtn.innerText = "REMOVE";
            couponBtn.setAttribute('onclick', 'removeCouponInline()');
            couponBtn.className = "px-4 py-2 bg-brand-red/10 text-brand-red border border-brand-red/20 hover:bg-brand-red hover:text-white font-black text-xs rounded-xl transition-all uppercase tracking-wider";
        }

        if (savingsBanner) {
            savingsBanner.classList.remove('hidden');
            savingsBanner.classList.add('flex');
        }
        if (savingsAmt) savingsAmt.innerText = `₹${discountAmt}`;
    } else {
        if (couponText) couponText.innerText = `No coupon applied`;
        if (couponSub) couponSub.innerText = `Select coupon to save flat discounts`;
        if (couponBtn) {
            couponBtn.innerText = "APPLY";
            couponBtn.setAttribute('onclick', 'openCouponsDrawer()');
            couponBtn.className = "px-4 py-2 bg-brand-gold/10 text-brand-gold border border-brand-gold/20 hover:bg-brand-gold hover:text-black font-black text-xs rounded-xl transition-all uppercase tracking-wider";
        }

        if (savingsBanner) {
            savingsBanner.classList.add('hidden');
            savingsBanner.classList.remove('flex');
        }
    }
}

// User auth and default values
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        let initialName = user.displayName || 'Customer';
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && userDoc.data().name) {
                initialName = userDoc.data().name;
            }
        } catch (e) {
            console.error("Error fetching user profile for name:", e);
        }

        const nameParts = initialName.split(' ');
        document.getElementById('fname-input').value = nameParts[0] || '';
        document.getElementById('lname-input').value = nameParts.slice(1).join(' ') || '';
        nameText = initialName;

        phoneText = localStorage.getItem('didisLastPhone') || '';
        document.getElementById('phone-input').value = phoneText;
        document.getElementById('display-contact').innerText = `${nameText}${phoneText ? ', ' + phoneText : ''}`;

        addressText = localStorage.getItem('didisLastAddress') || '';
        const displayAddressEl = document.getElementById('display-address');
        if (addressText) {
            if (displayAddressEl) displayAddressEl.innerText = addressText;
            document.getElementById('header-subtitle').innerText = "35-40 mins to Home | " + addressText;
            const addrInput = document.getElementById('address-input');
            if (addrInput) addrInput.value = addressText.split(',')[0] || '';
        } else {
            if (displayAddressEl) displayAddressEl.innerText = 'Please set your delivery address';
            document.getElementById('header-subtitle').innerText = '35-40 mins to Home | Set Address';
        }

        // Fetch wallet balance and defaults from Firestore users collection
        try {
            await expireUserWalletEntries(user.uid);
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists()) {
                const userData = userSnap.data();
                userWalletBalance = Number(userData.walletBalance) || 0;

                // Fallback to Firestore default address if local storage is empty
                if (!addressText && userData.addressLine) {
                    addressText = `${userData.addressLine}, ${userData.city || ''}, Assam - ${userData.zip || ''}`;
                    if (displayAddressEl) displayAddressEl.innerText = addressText;
                    document.getElementById('header-subtitle').innerText = "35-40 mins to Home | " + addressText;
                    const addrInput = document.getElementById('address-input');
                    if (addrInput) addrInput.value = userData.addressLine;
                    const cityInput = document.getElementById('city-input');
                    if (userData.city && cityInput) cityInput.value = userData.city;
                    const zipInput = document.getElementById('zip-input');
                    if (userData.zip && zipInput) zipInput.value = userData.zip;
                }

                // Fallback to Firestore default phone if local storage is empty
                if (!phoneText && userData.phone) {
                    phoneText = userData.phone;
                    document.getElementById('phone-input').value = phoneText;
                    document.getElementById('display-contact').innerText = `${nameText}${phoneText ? ', ' + phoneText : ''}`;
                }
            }

            // Update wallet checkout elements
            document.getElementById('wallet-balance-display').innerText = `₹${userWalletBalance.toFixed(2)}`;
            const checkbox = document.getElementById('use-wallet-checkbox');
            if (checkbox) {
                if (userWalletBalance > 0) {
                    checkbox.disabled = false;
                } else {
                    checkbox.disabled = true;
                    checkbox.checked = false;
                    useWallet = false;
                }
            }
            renderOrderSummary();
        } catch (e) {
            console.error("Error loading user profile or wallet:", e);
        }

        if (window.lucide) {
            window.lucide.createIcons();
        }

        if (typeof window.initCheckoutMap === 'function') {
            window.initCheckoutMap();
        }
    } else {
        localStorage.setItem('didiTriggerLogin', 'true');
        window.location.href = 'index.html';
    }
});

// Listen to Store Mode — disable delivery when store is in no-delivery mode
onSnapshot(doc(db, "storeSettings", "info"), (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();
    currentStoreSettings = {
        deliveryCharge: data.deliveryCharge !== undefined ? Number(data.deliveryCharge) : 40,
        taxPercentage: data.taxPercentage !== undefined ? Number(data.taxPercentage) : 5,
        minOrderForFreeDelivery: data.minOrderForFreeDelivery !== undefined ? Number(data.minOrderForFreeDelivery) : 499,
        ...data
    };

    let mode = data.storeMode || (data.isOnline ? 'open' : 'closed');
    if (data.autoOpenTime && data.autoCloseTime) {
        const now = new Date();
        const currentStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        let isInsideWindow = false;
        if (data.autoOpenTime <= data.autoCloseTime) {
            isInsideWindow = currentStr >= data.autoOpenTime && currentStr < data.autoCloseTime;
        } else {
            isInsideWindow = currentStr >= data.autoOpenTime || currentStr < data.autoCloseTime;
        }
        if (!isInsideWindow) {
            mode = 'closed';
        } else if (mode === 'closed') {
            mode = 'open';
        }
    }
    if (mode === 'closed' || mode === 'paused') {
        alert("The restaurant is currently offline. You cannot place an order at this time.");
        window.location.replace("index.html");
        return;
    }

    const deliveryLabel = document.getElementById('type-delivery-label');
    const noDeliveryNotice = document.getElementById('no-delivery-checkout-notice');

    if (mode === 'no-delivery') {
        // Force pickup mode
        selectOrderType('pickup');

        // Grey out delivery option
        if (deliveryLabel) {
            deliveryLabel.style.opacity = '0.3';
            deliveryLabel.style.pointerEvents = 'none';
            deliveryLabel.style.cursor = 'not-allowed';
        }

        // Show notice
        if (noDeliveryNotice) {
            noDeliveryNotice.classList.remove('hidden');
        }
    } else {
        // Re-enable delivery option
        if (deliveryLabel) {
            deliveryLabel.style.opacity = '1';
            deliveryLabel.style.pointerEvents = 'auto';
            deliveryLabel.style.cursor = 'pointer';
        }

        // Hide notice
        if (noDeliveryNotice) {
            noDeliveryNotice.classList.add('hidden');
        }
    }

    // Refresh calculations when settings update
    if (typeof renderOrderSummary === 'function') {
        renderOrderSummary();
    }
});

// Final Order Placement
window.submitOrderDirect = async () => {
    let mode = currentStoreSettings.storeMode || (currentStoreSettings.isOnline ? 'open' : 'closed');
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
            mode = 'closed';
        } else if (mode === 'closed') {
            mode = 'open';
        }
    }
    if (mode === 'closed' || mode === 'paused') {
        showToast("The restaurant is currently offline. You cannot place an order at this time.", "error");
        return;
    }

    if (orderType === 'delivery') {
        const addressInput = document.getElementById('address-input').value.trim();
        const latInput = document.getElementById('lat-input').value;
        const lngInput = document.getElementById('lng-input').value;

        if (!addressInput || !latInput || !lngInput) {
            showToast("Please pinpoint your exact delivery address on the map and provide address details.", "error");
            document.getElementById('address-input').focus();
            return;
        }

        addressText = addressInput;

        // Save back to profile automatically
        if (currentUser) {
            currentUser.address = addressText;
            currentUser.lat = Number(latInput);
            currentUser.lng = Number(lngInput);
            localStorage.setItem('didi_user', JSON.stringify(currentUser));
            setDoc(doc(db, "users", currentUser.uid), { address: addressText, lat: Number(latInput), lng: Number(lngInput) }, { merge: true }).catch(e => console.error("Could not update user profile", e));
        }

        // Validate City and ZIP Code if restrictions are enabled
        const userCity = document.getElementById('city-input') ? document.getElementById('city-input').value.trim() : '';
        const userZip = document.getElementById('zip-input') ? document.getElementById('zip-input').value.trim() : '';

        if (currentStoreSettings.allowedCities && currentStoreSettings.allowedCities.trim() !== '') {
            const allowedCities = currentStoreSettings.allowedCities.split(',').map(c => c.trim().toLowerCase());
            const addressLower = (addressText || '').toLowerCase();
            const hasAllowedCity = allowedCities.some(c => addressLower.includes(c));
            if (!hasAllowedCity) {
                showToast(`Delivery restricted! We currently only deliver to: ${currentStoreSettings.allowedCities}`, "error");
                if (document.getElementById('address-input')) document.getElementById('address-input').focus();
                return;
            }
        }

        if (currentStoreSettings.allowedZips && currentStoreSettings.allowedZips.trim() !== '') {
            const allowedZips = currentStoreSettings.allowedZips.split(',').map(z => z.trim());
            const addressLower = (addressText || '').toLowerCase();
            const hasAllowedZip = allowedZips.some(z => addressLower.includes(z));
            if (!hasAllowedZip) {
                showToast(`Delivery restricted! We do not deliver to ZIP code provided.`, "error");
                if (document.getElementById('address-input')) document.getElementById('address-input').focus();
                return;
            }
        }
    }

    if (!phoneText || phoneText.includes('Loading') || !phoneText.trim()) {
        showToast("Please set and save your phone number first.", "error");
        if (window.toggleContactEdit) window.toggleContactEdit();
        document.getElementById('phone-input').focus();
        return;
    }

    // Generate sequential order number
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
    } catch (e) {
        console.error("Counter error — deploy firestore.rules to fix this", e);
        orderNumber = null; // Will fallback to showing truncated Firestore ID
    }

    // Ensure nameText is fully up to date from inputs
    const fnameInp = document.getElementById('fname-input');
    const lnameInp = document.getElementById('lname-input');
    if (fnameInp && fnameInp.value) {
        nameText = fnameInp.value.trim() + (lnameInp && lnameInp.value ? ' ' + lnameInp.value.trim() : '');
    }

    const orderData = {
        userId: currentUser.uid,
        customer: nameText || 'Customer',
        email: currentUser.email || '',
        phone: phoneText,
        address: orderType === 'pickup' ? 'Dine-in / Pickup from Shop' : addressText,
        notes: cart.map(i => i.note ? `${i.name}: ${i.note}` : '').filter(n => n).join(' | '),
        paymentMethod: selectedPayment === 'cod' ? 'Cash on Delivery' : 'Online (Card/UPI)',
        orderType: orderType,
        orderNumber: orderNumber,
        location: orderType === 'delivery' ? { lat: Number(document.getElementById('lat-input').value), lng: Number(document.getElementById('lng-input').value) } : null,
        deliveryCharge: deliveryCharge,
        taxAmount: currentStoreSettings.taxPercentage !== undefined ? Number(currentStoreSettings.taxPercentage) : 10,
        items: cart,
        total: currentTotal + walletAppliedAmount,
        walletApplied: walletAppliedAmount,
        amountDue: currentTotal,
        discount: Number(localStorage.getItem('didisDiscount')) || 0,
        couponCode: localStorage.getItem('didisCoupon') || '',
        tipAmount: 0,
        donationAmount: donationAmount,
        status: 'Pending',
        statusTimestamps: { 'Pending': new Date().toISOString() },
        timestamp: new Date().toISOString()
    };

    const submitBtn = document.getElementById('place-order-btn');
    const oldText = submitBtn.innerHTML;
    submitBtn.innerHTML = `<i data-lucide="loader" class="w-4.5 h-4.5 animate-spin"></i> Placing Order...`;
    submitBtn.disabled = true;

    // Sync latest checkout details to user profile in Firestore
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            name: nameText,
            phone: phoneText,
            address: addressText
        }, { merge: true });
    } catch (err) {
        console.error("Error updating profile during checkout:", err);
    }

    // SCENARIO 1: Order is fully paid by wallet balance (currentTotal is 0)
    if (currentTotal === 0 && walletAppliedAmount > 0) {
        try {
            orderData.paymentMethod = 'Paid with Wallet';
            orderData.paymentId = 'WALLET-' + new Date().getTime();

            // 1. Create order doc
            const docRef = await addDoc(collection(db, "orders"), orderData);
            sendTelegramNotification(orderData);
            const notifyUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/notify-admin' : '/api/notify-admin';
            fetch(notifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: docRef.id }) }).catch(console.error);

            // 2. Deduct wallet balance from user profile
            await consumeWalletEntries(currentUser.uid, walletAppliedAmount);

            clearLocalCart();
            showToast("Order placed successfully via Wallet!", "success");

            const overlay = document.getElementById('payment-loading-overlay');
            if (overlay) {
                document.getElementById('payment-overlay-text').innerText = "Confirming your Order...";
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
            }
            setTimeout(() => window.location.href = 'dashboard.html', 2500);
        } catch (err) {
            console.error(err);
            showToast("Failed to place order.", "error");
            submitBtn.innerHTML = oldText;
            submitBtn.disabled = false;
        }
        return;
    }

    // SCENARIO 2: COD Order
    if (selectedPayment === 'cod') {
        try {
            const docRef = await addDoc(collection(db, "orders"), orderData);
            sendTelegramNotification(orderData);
            const notifyUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/notify-admin' : '/api/notify-admin';
            fetch(notifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: docRef.id }) }).catch(console.error);

            // Deduct wallet balance if any was applied
            if (walletAppliedAmount > 0) {
                await consumeWalletEntries(currentUser.uid, walletAppliedAmount);
            }

            clearLocalCart();
            showToast("Order placed successfully!", "success");

            const overlay = document.getElementById('payment-loading-overlay');
            if (overlay) {
                document.getElementById('payment-overlay-text').innerText = "Confirming your Order...";
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
            }
            setTimeout(() => window.location.href = 'dashboard.html', 2500);
        } catch (err) {
            console.error(err);
            showToast("Failed to place order.", "error");
            submitBtn.innerHTML = oldText;
            submitBtn.disabled = false;
        }
    } else {
        // SCENARIO 3: Razorpay Payment
        orderData.status = 'Payment Pending';
        orderData.statusTimestamps = { 'Payment Pending': new Date().toISOString() };
        let docRef;
        try {
            docRef = await addDoc(collection(db, "orders"), orderData);
        } catch (err) {
            console.error(err);
            showToast("Failed to initiate order.", "error");
            submitBtn.innerHTML = oldText;
            submitBtn.disabled = false;
            return;
        }

        const options = {
            "key": "rzp_live_Suhxp1cUZNzELt",
            "amount": Math.round(currentTotal * 100),
            "payment_capture": 1,
            "currency": "INR",
            "name": "Didi's Biryani",
            "description": "Order Payment",
            "image": "https://images.unsplash.com/photo-1633948332857-e685f67b4585?q=80&w=150",
            "handler": async function (response) {
                try {
                    const paymentId = response.razorpay_payment_id;
                    orderData.paymentId = paymentId;
                    orderData.paymentMethod = 'Online (Razorpay)';

                    showToast("Payment Successful! Capturing payment...", "info");

                    // 1. Call Vercel Backend to Capture the Payment securely
                    const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
                    const verifyUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/verify-payment' : '/api/verify-payment';
                    const captureRes = await fetch(verifyUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': token ? `Bearer ${token}` : ''
                        },
                        body: JSON.stringify({
                            paymentId: paymentId,
                            amount: currentTotal
                        })
                    });

                    const captureData = await captureRes.json();

                    if (!captureRes.ok || !captureData.success) {
                        throw new Error(captureData.error ? JSON.stringify(captureData.error) : "Payment capture failed on server");
                    }

                    // 2. Save to Firestore only if capture was successful
                    showToast("Payment Captured! Confirming order...", "success");

                    const captureTime = new Date().toISOString();
                    orderData.paymentId = paymentId;
                    orderData.paymentMethod = 'Online (Razorpay)';
                    orderData.status = 'Pending';
                    orderData.statusTimestamps['Pending'] = captureTime;

                    await setDoc(docRef, {
                        paymentId: paymentId,
                        paymentMethod: 'Online (Razorpay)',
                        status: 'Pending',
                        [`statusTimestamps.Pending`]: captureTime
                    }, { merge: true });

                    sendTelegramNotification(orderData);
                    const notifyUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'https://didisbiryani.in/api/notify-admin' : '/api/notify-admin';
                    fetch(notifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: docRef.id }) }).catch(console.error);

                    // Deduct wallet balance if any was applied
                    if (walletAppliedAmount > 0) {
                        await consumeWalletEntries(currentUser.uid, walletAppliedAmount);
                    }

                    clearLocalCart();

                    const overlay = document.getElementById('payment-loading-overlay');
                    if (overlay) {
                        document.getElementById('payment-overlay-text').innerText = "Confirming your Payment...";
                        overlay.classList.remove('hidden');
                        overlay.classList.add('flex');
                    }
                    setTimeout(() => window.location.href = 'dashboard.html', 2500);
                } catch (err) {
                    console.error("Firebase Error: ", err);
                    alert("Failed to save order: " + err.message + "\n\nPayment ID: " + response.razorpay_payment_id);
                }
            },
            "prefill": {
                "name": typeof nameText !== 'undefined' ? nameText : "",
                "email": (typeof currentUser !== 'undefined' && currentUser && currentUser.email) ? currentUser.email : "customer@example.com",
                "contact": typeof phoneText !== 'undefined' ? phoneText : ""
            },
            "theme": {
                "color": "#D4A017"
            }
        };

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response) {
            console.error(response.error);
            showToast(response.error.description || "Payment failed", "error");
            submitBtn.innerHTML = oldText;
            submitBtn.disabled = false;
        });
        rzp.open();
    }
};

function clearLocalCart() {
    cart = [];
    localStorage.setItem('didisCart', JSON.stringify([]));
    localStorage.removeItem('didisCoupon');
    localStorage.removeItem('didisDiscount');
    localStorage.removeItem('didisCouponType');
    localStorage.removeItem('didisCouponData');
}

// Premium Lenis Smooth Scroll Initialization for Checkout Page
function initLenis() {
    if (typeof Lenis === 'undefined') return;
    const lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Luxurious exponential scroll easing
        direction: 'vertical',
        gestureDirection: 'vertical',
        smooth: true,
        mouseMultiplier: 1,
        smoothTouch: false,
        touchMultiplier: 1.5,
        infinite: false,
    });
    window.lenis = lenis;
    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
}

// Premium Scroll Reveal Observer for Checkout Page
let scrollRevealObserver = null;
function observeNewElements() {
    if (!scrollRevealObserver) {
        scrollRevealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('reveal-active');
                    scrollRevealObserver.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.02,
            rootMargin: "0px 0px -20px 0px"
        });
    }

    const items = document.querySelectorAll('.reveal-element, .reveal-lift, .reveal-fade-in, .reveal-slide-left, .reveal-slide-right');
    items.forEach((el) => {
        scrollRevealObserver.observe(el);
    });
}

// Initializations
function initCheckout() {
    initLenis();
    renderCheckoutItems();
    renderOrderSummary();
    loadCrossSellItems();
    loadCouponsForDrawer();
    if (window.lucide) {
        window.lucide.createIcons();
    }
    setTimeout(observeNewElements, 100);
}

document.addEventListener('DOMContentLoaded', initCheckout);
