import { db, collection, addDoc, auth, provider, signInWithGoogle, getRedirectResult, onAuthStateChanged, signOut, query, where, getDocs, onSnapshot, doc } from './firebase-config.js';

let currentStoreSettings = { taxPercentage: 5, deliveryCharge: 40, minOrderForFreeDelivery: 499 };

// Listen to Store Status for no-delivery banner and operational settings
onSnapshot(doc(db, "storeSettings", "info"), (docSnap) => {
    const noDeliveryBanner = document.getElementById('no-delivery-banner');
    if (docSnap.exists()) {
        const data = docSnap.data();
        currentStoreSettings = {
            taxPercentage: data.taxPercentage !== undefined ? Number(data.taxPercentage) : 5,
            deliveryCharge: data.deliveryCharge !== undefined ? Number(data.deliveryCharge) : 40,
            minOrderForFreeDelivery: data.minOrderForFreeDelivery !== undefined ? Number(data.minOrderForFreeDelivery) : 499,
            ...data
        };
        
        const mode = data.storeMode || (data.isOnline ? 'open' : 'closed');
        if (noDeliveryBanner) {
            if (mode === 'no-delivery') {
                noDeliveryBanner.classList.remove('hidden');
                noDeliveryBanner.classList.add('flex');
            } else {
                noDeliveryBanner.classList.add('hidden');
                noDeliveryBanner.classList.remove('flex');
            }
        }
        
        // Re-render to update tax/delivery dynamically
        if (typeof renderCart === 'function') {
            renderCart();
        }
    }
});

let cart = JSON.parse(localStorage.getItem('didisCart')) || [];
let currentUser = null;
let appliedCoupon = null;
try {
    const savedCoupon = localStorage.getItem('didisCouponData');
    if (savedCoupon) appliedCoupon = JSON.parse(savedCoupon);
} catch(e) {
    console.error("Error loading saved coupon", e);
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const loginBtn = document.getElementById('login-btn-desktop');
    const logoutBtn = document.getElementById('logout-btn-desktop');
    if(user) {
        if(loginBtn) loginBtn.classList.add('hidden');
        if(logoutBtn) logoutBtn.classList.remove('hidden');
    } else {
        if(loginBtn) loginBtn.classList.remove('hidden');
        if(logoutBtn) logoutBtn.classList.add('hidden');
    }
});

window.handleLogin = async () => {
    try { 
        if (window.AndroidBridge && typeof window.AndroidBridge.startGoogleSignIn === 'function') {
            window.AndroidBridge.startGoogleSignIn();
            return;
        }
        await signInWithGoogle(auth, provider); 
    } catch(e) { 
        console.error("Login failed", e); 
        let friendlyMsg = e.message;
        if (window.location.protocol === 'file:') {
            friendlyMsg += "\n\n⚠️ NOTE: Firebase Google Sign-In is BLOCKED on local 'file://' paths. Please run the project using a local HTTP/HTTPS server (like Live Server in VS Code) to login successfully!";
        }
        alert("Login failed! " + friendlyMsg);
    }
};
window.handleLogout = async () => {
    await signOut(auth);
    window.location.reload();
};

function renderCart() {
    const tbody = document.getElementById('cart-table-body');
    let subtotal = 0;

    if (cart.length === 0) {
        tbody.innerHTML = `
            <div class="p-12 text-center text-brand-white/50">
                <i data-lucide="shopping-cart" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
                <p class="text-lg">Your cart is currently empty.</p>
                <a href="index.html#menu-section" class="inline-block mt-4 px-6 py-2 bg-brand-gold text-black rounded-full font-bold">Browse Menu</a>
            </div>
        `;
        document.getElementById('summary-subtotal').innerText = 0;
        document.getElementById('summary-total').innerText = 0;
        if(window.lucide) lucide.createIcons();
        return;
    }

    tbody.innerHTML = '';
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        const custStr = item.customizations ? Object.values(item.customizations).join(', ') : '';

        const typeBadge = item.isVeg === 'true' || item.isVeg === true 
            ? `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-green-600 flex-shrink-0"><span class="w-1 h-1 rounded-full bg-green-600"></span></span>`
            : `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-red-600 flex-shrink-0"><span class="w-1 h-1 rounded-full bg-red-600"></span></span>`;

        tbody.innerHTML += `
            <div class="flex flex-col sm:grid sm:grid-cols-12 gap-4 p-6 items-center border-b border-white/5 relative group hover:bg-white/5 transition-colors">
                
                <!-- Remove Button (Mobile: top right, Desktop: far left) -->
                <button onclick="removeItem(${index})" class="absolute top-4 right-4 sm:static sm:col-span-1 text-brand-white/30 hover:text-brand-red transition-colors flex justify-center">
                    <i data-lucide="x-circle" class="w-5 h-5"></i>
                </button>

                <!-- Product Detail -->
                <div class="sm:col-span-5 flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left w-full">
                    <div class="w-16 h-16 rounded-lg bg-black/50 overflow-hidden border border-white/10 flex-shrink-0">
                        <img src="${item.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=200'}" class="w-full h-full object-cover">
                    </div>
                    <div>
                        <div class="flex items-center justify-center sm:justify-start gap-2">
                            ${typeBadge}
                            <h4 class="text-brand-white font-bold">${item.name}${item.variantLabel ? ` <span class="text-brand-gold text-xs font-normal">— ${item.variantLabel}</span>` : ''}</h4>
                        </div>
                        ${item.quantityLabel ? `<p class="text-[10px] text-brand-gold/70 font-bold mt-0.5">${item.quantityLabel}</p>` : ''}
                        ${custStr ? `<p class="text-xs text-brand-white/50 mt-1 max-w-[200px]">${custStr}</p>` : ''}
                    </div>
                </div>

                <!-- Price -->
                <div class="sm:col-span-2 text-center text-sm text-brand-white/70 w-full sm:w-auto flex justify-between sm:block">
                    <span class="sm:hidden font-bold">Price:</span> ₹${item.price}
                </div>

                <!-- Quantity -->
                <div class="sm:col-span-2 flex justify-center w-full sm:w-auto">
                    <div class="flex items-center gap-3 bg-black/40 rounded-full px-3 py-1 border border-white/10">
                        <button onclick="updateQty(${index}, -1)" class="text-brand-white/50 hover:text-brand-gold"><i data-lucide="minus" class="w-3 h-3"></i></button>
                        <span class="text-brand-white font-bold text-sm w-4 text-center">${item.quantity}</span>
                        <button onclick="updateQty(${index}, 1)" class="text-brand-white/50 hover:text-brand-gold"><i data-lucide="plus" class="w-3 h-3"></i></button>
                    </div>
                </div>

                <!-- Sub-total -->
                <div class="sm:col-span-2 text-right font-bold text-brand-gold w-full sm:w-auto flex justify-between sm:block border-t border-white/10 sm:border-0 pt-4 sm:pt-0 mt-4 sm:mt-0">
                    <span class="sm:hidden text-brand-white font-bold">Subtotal:</span> ₹${itemTotal}
                </div>
            </div>
        `;
    });

    document.getElementById('summary-subtotal').innerText = subtotal;
    
    let discountAmount = 0;
    if (appliedCoupon) {
        if (subtotal < appliedCoupon.minOrder) {
            appliedCoupon = null;
            showToast("Coupon removed: Minimum order value not met.", "error");
        } else {
            if (appliedCoupon.targetType === 'specific_item') {
                const targetItem = cart.find(i => i.id === appliedCoupon.targetItemId);
                if (!targetItem) {
                    appliedCoupon = null;
                    showToast("Coupon removed: Target item no longer in cart.", "error");
                } else if (appliedCoupon.type === 'bogo' && targetItem.quantity < 2) {
                    appliedCoupon = null;
                    showToast("Coupon removed: BOGO requires 2 items.", "error");
                } else {
                    const itemSubtotal = targetItem.price * targetItem.quantity;
                    if (appliedCoupon.type === 'percent') {
                        discountAmount = (itemSubtotal * appliedCoupon.value) / 100;
                    } else if (appliedCoupon.type === 'fixed') {
                        discountAmount = Math.min(appliedCoupon.value, itemSubtotal);
                    } else if (appliedCoupon.type === 'bogo') {
                        discountAmount = targetItem.price; 
                    }
                }
            } else {
                if (appliedCoupon.type === 'percent') {
                    discountAmount = (subtotal * appliedCoupon.value) / 100;
                } else if (appliedCoupon.type === 'fixed') {
                    discountAmount = Math.min(appliedCoupon.value, subtotal);
                } else if (appliedCoupon.type === 'free_delivery') {
                    discountAmount = 0; // Free delivery is deducted from delivery fee, not food total
                }
            }
        }
    }
    
    document.getElementById('summary-discount').innerText = `₹${discountAmount}`;
    
    // Dynamic Delivery Fee
    let deliveryCharge = currentStoreSettings.deliveryCharge !== undefined ? currentStoreSettings.deliveryCharge : 40;
    if (subtotal >= (currentStoreSettings.minOrderForFreeDelivery || 499) || (appliedCoupon && appliedCoupon.type === 'free_delivery')) {
        deliveryCharge = 0;
    } else {
        const zip = localStorage.getItem('didisZip') || '';
        const zones = currentStoreSettings.deliveryZones || [];
        const matchedZone = zones.find(z => z.zip === zip);
        
        if (matchedZone) {
            deliveryCharge = matchedZone.charge !== undefined ? Number(matchedZone.charge) : deliveryCharge;
        }
    }
    const delSpan = document.getElementById('summary-delivery');
    if (delSpan) {
        delSpan.innerText = deliveryCharge === 0 ? 'Free' : `₹${deliveryCharge}`;
        delSpan.className = deliveryCharge === 0 ? 'font-bold text-green-500' : 'font-bold text-brand-white';
    }

    // Dynamic Packing Charges calculation
    const taxAmt = currentStoreSettings.taxPercentage !== undefined ? Number(currentStoreSettings.taxPercentage) : 10;
    const taxLabel = document.getElementById('summary-tax-label');
    const taxSpan = document.getElementById('summary-tax');
    if (taxLabel) {
        taxLabel.innerText = `Packing Charges`;
    }
    if (taxSpan) {
        taxSpan.innerText = taxAmt;
    }

    const totalVal = subtotal - discountAmount + deliveryCharge + taxAmt;
    document.getElementById('summary-total').innerText = totalVal;
    
    localStorage.setItem('didisDiscount', discountAmount);
    localStorage.setItem('didisCoupon', appliedCoupon ? appliedCoupon.code : '');
    localStorage.setItem('didisCouponType', appliedCoupon ? appliedCoupon.type : '');
    localStorage.setItem('didisCouponData', appliedCoupon ? JSON.stringify(appliedCoupon) : '');

    const statusDiv = document.getElementById('applied-coupon-status');
    const codeSpan = document.getElementById('applied-coupon-code');
    if (appliedCoupon) {
        if (statusDiv && codeSpan) {
            statusDiv.classList.remove('hidden');
            let desc = '';
            if (appliedCoupon.type === 'percent') desc = `${appliedCoupon.value}% OFF`;
            else if (appliedCoupon.type === 'fixed') desc = `₹${appliedCoupon.value} OFF`;
            else if (appliedCoupon.type === 'free_delivery') desc = `Free Delivery`;
            else if (appliedCoupon.type === 'bogo') desc = `BOGO`;
            codeSpan.innerText = `${appliedCoupon.code} (${desc})`;
        }
    } else {
        if (statusDiv) statusDiv.classList.add('hidden');
    }

    renderCouponRecommendations(subtotal);

    if(window.lucide) lucide.createIcons();
    localStorage.setItem('didisCart', JSON.stringify(cart));
}

async function renderCouponRecommendations(subtotal) {
    const container = document.getElementById('coupon-recommendations');
    if(!container) return;

    try {
        const q = query(collection(db, "coupons"), where("isActive", "==", true));
        const snapshot = await getDocs(q);
        
        container.innerHTML = '';
        if(snapshot.empty) return;

        snapshot.forEach(docSnap => {
            const c = docSnap.data();
            
            // Basic logic: only show if subtotal >= minOrder, OR if it's close to minOrder
            let title = c.type === 'percent' ? `${c.value}% OFF` : (c.type === 'fixed' ? `₹${c.value} OFF` : (c.type === 'free_delivery' ? 'Free Delivery' : 'BOGO'));
            let desc = `On orders above ₹${c.minOrder}`;
            
            if (c.targetType === 'specific_item') desc += ' (Specific item only)';
            if (c.targetAudience === 'new_users') desc += ' (New users only)';

            const meetsMin = subtotal >= c.minOrder;
            
            // Render a nice chip/card
            container.innerHTML += `
                <div class="border border-white/10 rounded-xl p-3 flex justify-between items-center bg-white/5 ${meetsMin ? 'border-brand-gold/50' : 'opacity-50'}">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-brand-gold text-sm">${c.code}</span>
                            <span class="text-xs bg-white/10 px-2 py-0.5 rounded text-brand-white">${title}</span>
                        </div>
                        <p class="text-[10px] text-brand-white/50 mt-1">${desc}</p>
                    </div>
                    ${meetsMin ? `<button onclick="document.getElementById('coupon-input').value='${c.code}'; applyCoupon();" class="text-xs font-bold text-brand-gold hover:text-white transition-colors">Apply</button>` 
                              : `<span class="text-[10px] text-brand-white/30">Add ₹${c.minOrder - subtotal} more</span>`}
                </div>
            `;
        });
    } catch(e) {
        console.error("Error fetching recommendations:", e);
    }
}

window.removeAppliedCoupon = () => {
    appliedCoupon = null;
    localStorage.removeItem('didisCoupon');
    localStorage.removeItem('didisDiscount');
    localStorage.removeItem('didisCouponType');
    localStorage.removeItem('didisCouponData');
    showToast("Coupon removed", "info");
    renderCart();
};

window.updateQty = (index, change) => {
    if (cart[index].quantity + change > 0) {
        cart[index].quantity += change;
        renderCart();
    }
};

window.removeItem = (index) => {
    cart.splice(index, 1);
    renderCart();
};

window.clearCart = () => {
    if(confirm("Are you sure you want to empty your cart?")) {
        cart = [];
        renderCart();
    }
};

window.initiateCheckout = async () => {
    if (cart.length === 0) return showToast("Your cart is empty!", "info");
    
    if (!currentUser) {
        showToast("Please login to proceed with checkout.", "info");
        await handleLogin();
        if (!currentUser) return; // User cancelled login
    }
    
    window.location.href = 'checkout.html';
};

// Premium Lenis Smooth Scroll Initialization for Cart Page
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

// Premium Scroll Reveal Observer for Cart Page
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

// Init
document.addEventListener('DOMContentLoaded', async () => {
    initLenis();
    renderCart();
    setTimeout(observeNewElements, 100);

    // Consume Google Redirect Sign-In result
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            currentUser = result.user;
            console.log("Logged in via redirect inside cart successfully!");
        }
    } catch (e) {
        console.error("Error processing Google redirect login inside cart:", e);
    }
});

window.applyCoupon = async () => {
    const codeInput = document.getElementById('coupon-input');
    const code = codeInput.value.toUpperCase().trim();
    if (!code) return showToast("Please enter a coupon code", "info");
    
    // Original button text
    const btn = codeInput.nextElementSibling;
    const oldText = btn.innerText;
    btn.innerText = "Applying...";
    btn.disabled = true;

    try {
        const q = query(collection(db, "coupons"), where("code", "==", code), where("isActive", "==", true));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            btn.innerText = oldText;
            btn.disabled = false;
            return showToast("Invalid or expired coupon code.", "error");
        }
        
        const coupon = querySnapshot.docs[0].data();
        
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (subtotal < coupon.minOrder) {
            btn.innerText = oldText;
            btn.disabled = false;
            return showToast(`This coupon requires a minimum order of ₹${coupon.minOrder}`, "error");
        }
        
        if (coupon.targetAudience === 'new_users') {
            if (!currentUser) {
                showToast("Please login first to verify your new user status.", "info");
                return;
            }
            const ordersQ = query(collection(db, "orders"), where("userId", "==", currentUser.uid));
            const ordersSnap = await getDocs(ordersQ);
            if (!ordersSnap.empty) {
                btn.innerText = oldText;
                btn.disabled = false;
                return showToast("This coupon is for New Users only.", "error");
            }
        }

        if (coupon.targetType === 'specific_item') {
            const hasItem = cart.find(item => item.id === coupon.targetItemId);
            if (!hasItem) {
                btn.innerText = oldText;
                btn.disabled = false;
                return showToast("This coupon does not apply to the items in your cart.", "error");
            }
            if (coupon.type === 'bogo' && hasItem.quantity < 2) {
                btn.innerText = oldText;
                btn.disabled = false;
                return showToast("Buy 1 Get 1 Free requires at least 2 of the specific items in your cart.", "error");
            }
        }
        
        appliedCoupon = coupon;
        showToast("Coupon applied successfully!", "success");
        renderCart(); 
    } catch(e) {
        console.error(e);
        showToast("Error applying coupon.", "error");
    } finally {
        btn.innerText = oldText;
        btn.disabled = false;
    }
};
