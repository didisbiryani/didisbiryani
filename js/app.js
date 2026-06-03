import { db, collection, getDocs, getDoc, addDoc, auth, provider, signInWithGoogle, getRedirectResult, onAuthStateChanged, signOut, onSnapshot, setDoc, doc, query, where, signInWithCredential } from './firebase-config.js';
import { GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const APP_VERSION = '1.0.0';

// Detect if running inside the Android App (TWA / PWA / Standalone)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('source') === 'android_app') {
    localStorage.setItem('isAndroidApp', 'true');
}
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || document.referrer.includes('android-app://');
const isAndroidApp = isStandalone || localStorage.getItem('isAndroidApp') === 'true';

let cart = JSON.parse(localStorage.getItem('didisCart')) || [];
let total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
let allMenuItems = [];
let currentUser = null;
let userCategoryPrefs = []; // Stores categories sorted by order frequency
let currentCategoryFilter = 'All'; // New global for Swiggy bubbles
let currentStoreSettings = { bannerInterval: 5 };

// Zomato Redesign Filter States
let vegOnlyFilter = false;
let ratingFilter = false;
let under150Filter = false;
let searchQuery = "";

let activeCoupons = [];
let customerChatUnsubscribe = null;

// Auth Logic
function updateAuthUI(user) {
    const loginBtnD = document.getElementById('login-btn-desktop');
    const logoutBtnD = document.getElementById('logout-btn-desktop');
    const dashNavD = document.getElementById('nav-dashboard-desktop');
    const adminNavD = document.getElementById('nav-admin-desktop');
    
    const loginBtnM = document.getElementById('login-btn-mobile');
    const logoutBtnM = document.getElementById('logout-btn-mobile');
    const dashNavM = document.getElementById('nav-dashboard-mobile');
    const adminNavM = document.getElementById('nav-admin-mobile');

    // Mobile Header elements
    const loginBtnMobileHeader = document.getElementById('login-btn-mobile-header');
    const dashBtnMobileHeader = document.getElementById('dashboard-btn-mobile-header');
    const avatarMobileHeader = document.getElementById('user-avatar-mobile-header');

    const isAdmin = user && user.email === 'didisbiryani@gmail.com';

    if (user) {
        if(loginBtnD) loginBtnD.classList.add('hidden');
        if(logoutBtnD) logoutBtnD.classList.remove('hidden');
        if(dashNavD) dashNavD.classList.remove('hidden');
        
        if(loginBtnM) loginBtnM.classList.add('hidden');
        if(logoutBtnM) logoutBtnM.classList.remove('hidden');
        if(dashNavM) dashNavM.classList.remove('hidden');

        if (loginBtnMobileHeader) loginBtnMobileHeader.classList.add('hidden');
        if (dashBtnMobileHeader) {
            dashBtnMobileHeader.classList.remove('hidden');
            if (avatarMobileHeader) {
                avatarMobileHeader.src = user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=80';
            }
        }

        // Show/hide admin panel links
        if(adminNavD) {
            if (isAdmin) adminNavD.classList.remove('hidden');
            else adminNavD.classList.add('hidden');
        }
        if(adminNavM) {
            if (isAdmin) adminNavM.classList.remove('hidden');
            else adminNavM.classList.add('hidden');
        }
    } else {
        if(loginBtnD) loginBtnD.classList.remove('hidden');
        if(logoutBtnD) logoutBtnD.classList.add('hidden');
        if(dashNavD) dashNavD.classList.add('hidden');
        if(adminNavD) adminNavD.classList.add('hidden');
        
        if(loginBtnM) loginBtnM.classList.remove('hidden');
        if(logoutBtnM) logoutBtnM.classList.add('hidden');
        if(dashNavM) dashNavM.classList.add('hidden');
        if(adminNavM) adminNavM.classList.add('hidden');

        if (loginBtnMobileHeader) loginBtnMobileHeader.classList.remove('hidden');
        if (dashBtnMobileHeader) dashBtnMobileHeader.classList.add('hidden');

        // Hide chat widget for logged out users
        const chatWidget = document.getElementById('customer-chat-widget');
        if(chatWidget) chatWidget.classList.add('hidden');
        if(customerChatUnsubscribe) {
            customerChatUnsubscribe();
            customerChatUnsubscribe = null;
        }
    }
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    updateAuthUI(user);
    
    // Show chat widget and start global listener for logged in users
    const chatWidget = document.getElementById('customer-chat-widget');
    if (user) {
        if (chatWidget) {
            chatWidget.classList.remove('hidden');
            chatWidget.classList.add('flex');
        }
        initGlobalChatListener(user);

        // Save pending FCM token if it exists
        const pendingToken = localStorage.getItem('pendingFcmToken');
        if (pendingToken) {
            setDoc(doc(db, "users", user.uid), {
                fcmToken: pendingToken
            }, { merge: true }).then(() => {
                localStorage.removeItem('pendingFcmToken');
                console.log("Pending FCM token saved to user profile.");
            }).catch(e => console.error("Error saving pending FCM token", e));
        }

        // Check if checkout redirect was active
        const isCheckoutRedirectPending = localStorage.getItem('didiRedirectPending') === 'true' || localStorage.getItem('didiTriggerLogin') === 'true';
        
        if (isCheckoutRedirectPending) {
            localStorage.removeItem('didiRedirectPending');
            localStorage.removeItem('didiTriggerLogin');

            try {
                const userSnap = await getDoc(doc(db, "users", user.uid));
                let hasPhone = false;
                let hasAddress = false;
                let phoneVal = '';
                let addressVal = '';

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    if (userData.phone) { hasPhone = true; phoneVal = userData.phone; }
                    if (userData.address) { hasAddress = true; addressVal = userData.address; }
                }

                // Fallback / sync from LocalStorage
                const localPhone = localStorage.getItem('didisLastPhone');
                const localAddress = localStorage.getItem('didisLastAddress');

                if (!hasPhone && localPhone) { hasPhone = true; phoneVal = localPhone; }
                if (!hasAddress && localAddress) { hasAddress = true; addressVal = localAddress; }

                if (hasPhone && hasAddress) {
                    // Sync to Firestore in background
                    await setDoc(doc(db, "users", user.uid), {
                        phone: phoneVal,
                        address: addressVal
                    }, { merge: true });
                    window.location.href = 'checkout.html';
                    return; // Redirecting, stop here!
                } else {
                    // Incomplete profile, prompt completion first but remember to redirect them to checkout afterwards
                    localStorage.setItem('didiRedirectToCheckoutAfterProfileComplete', 'true');
                    openCompleteProfileModal();
                    return;
                }
            } catch (e) {
                console.error("Error processing checkout redirect completion check:", e);
            }
        }

        // Standard profile completeness check (for normal logins/page loads)
        try {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            let hasPhone = false;
            let hasAddress = false;
            let phoneVal = '';
            let addressVal = '';

            if (userSnap.exists()) {
                const userData = userSnap.data();
                if (userData.phone) { hasPhone = true; phoneVal = userData.phone; }
                if (userData.address) { hasAddress = true; addressVal = userData.address; }
            }

            // Sync from local storage
            const localPhone = localStorage.getItem('didisLastPhone');
            const localAddress = localStorage.getItem('didisLastAddress');

            if (!hasPhone && localPhone) { hasPhone = true; phoneVal = localPhone; }
            if (!hasAddress && localAddress) { hasAddress = true; addressVal = localAddress; }

            if (hasPhone && hasAddress) {
                // Profile is complete! Ensure synced to Firestore
                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    if (!userData.phone || !userData.address) {
                        await setDoc(doc(db, "users", user.uid), {
                            phone: phoneVal,
                            address: addressVal
                        }, { merge: true });
                    }
                } else {
                    await setDoc(doc(db, "users", user.uid), {
                        name: user.displayName || 'Customer',
                        email: user.email || '',
                        photo: user.photoURL || '',
                        phone: phoneVal,
                        address: addressVal
                    }, { merge: true });
                }
            } else {
                // Profile is truly incomplete on both device and DB
                openCompleteProfileModal();
            }
        } catch (e) {
            console.error("Error checking user profile completion status", e);
        }
    }

    // Fetch order history for recommendations
    if (user) {
        try {
            const q = query(collection(db, 'orders'), where('userId', '==', user.uid));
            const snapshot = await getDocs(q);
            const isNewUser = snapshot.empty;
            const categoryCounts = {};
            
            snapshot.forEach(docSnap => {
                const order = docSnap.data();
                if (order.items) {
                    order.items.forEach(item => {
                        const cat = item.category || 'Other';
                        categoryCounts[cat] = (categoryCounts[cat] || 0) + item.quantity;
                    });
                }
            });
            
            // Sort categories by most ordered
            userCategoryPrefs = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a]);
            
            renderDynamicTopBanner(isNewUser);
            
            // Re-render menu to apply personalized sorting if items are already loaded
            if (allMenuItems.length > 0) {
                renderMenuItems(allMenuItems);
                renderRecommendedCarousel();
            }
        } catch(e) {
            console.error("Error fetching order history for recommendations", e);
        }
    } else {
        userCategoryPrefs = [];
        renderDynamicTopBanner(true);
        if (allMenuItems.length > 0) {
            renderMenuItems(allMenuItems);
            renderRecommendedCarousel();
        }
    }
});

async function renderDynamicTopBanner(isNewUser) {
    const banner = document.getElementById('dynamic-top-banner');
    if (!banner) return;
    
    try {
        const q = query(collection(db, "coupons"), where("isActive", "==", true));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            banner.innerHTML = `Welcome to Didi's Biryani!`;
            return;
        }

        let bestCoupon = null;
        let bestScore = -1;

        snapshot.forEach(docSnap => {
            const c = docSnap.data();
            if (!isNewUser && c.targetAudience === 'new_users') return; // Skip new user coupons for old users
            
            let score = 0;
            if (c.targetAudience === 'new_users' && isNewUser) score += 1000; // Heavily weight new user coupons for new users
            if (c.type === 'percent') score += c.value;
            if (c.type === 'fixed') score += (c.value / 10);
            if (c.type === 'bogo') score += 50;
            if (c.type === 'free_delivery') score += 40;

            if (score > bestScore) {
                bestScore = score;
                bestCoupon = c;
            }
        });

        if (bestCoupon) {
            let discountText = bestCoupon.type === 'percent' ? `${bestCoupon.value}% OFF` : (bestCoupon.type === 'fixed' ? `₹${bestCoupon.value} OFF` : (bestCoupon.type === 'free_delivery' ? 'Free Delivery' : 'Buy 1 Get 1 Free'));
            let conditionText = bestCoupon.minOrder > 0 ? ` on orders over ₹${bestCoupon.minOrder}` : '';
            let targetText = bestCoupon.targetType === 'specific_item' ? ' on select items' : conditionText;
            
            banner.innerHTML = `
                <span class="text-brand-black/70 mr-1 hidden sm:inline">Best Offer:</span> 
                ${discountText}${targetText} 
                <span class="ml-2 px-2 py-0.5 bg-black text-brand-gold rounded font-black cursor-pointer hover:bg-white transition-colors uppercase tracking-widest text-[10px]" onclick="window.location.href='cart.html'">Code: ${bestCoupon.code}</span>
            `;
        } else {
            banner.innerHTML = `Welcome to Didi's Biryani!`;
        }
    } catch(e) {
        console.error("Error fetching banner coupon", e);
        banner.innerHTML = `Welcome to Didi's Biryani!`;
    }
}

window.handleLogin = async () => {
    try {
        if (window.AndroidBridge && typeof window.AndroidBridge.startGoogleSignIn === 'function') {
            window.AndroidBridge.startGoogleSignIn();
            return;
        }

        const result = await signInWithGoogle(auth, provider);
        if (!result) return; // If undefined, redirect is taking place
        currentUser = result.user;
        updateAuthUI(currentUser);
        // Save user to DB if not exists
        await setDoc(doc(db, "users", currentUser.uid), {
            name: currentUser.displayName,
            email: currentUser.email,
            photo: currentUser.photoURL
        }, { merge: true });
    } catch(e) {
        console.error("Login failed", e);
        // Direct browser alert explaining local vs server blocks
        let friendlyMsg = e.message;
        if (window.location.protocol === 'file:') {
            friendlyMsg += "\n\n⚠️ NOTE: Firebase Google Sign-In is BLOCKED on local 'file://' paths. Please run the project using a local HTTP/HTTPS server (like Live Server in VS Code) to login successfully!";
        }
        alert("Login failed! " + friendlyMsg);
    }
};

window.handleNativeGoogleSignIn = async (idToken) => {
    try {
        const credential = GoogleAuthProvider.credential(idToken);
        const result = await signInWithCredential(auth, credential);
        currentUser = result.user;
        updateAuthUI(currentUser);
        
        await setDoc(doc(db, "users", currentUser.uid), {
            name: currentUser.displayName,
            email: currentUser.email,
            photo: currentUser.photoURL
        }, { merge: true });
        
        const isCheckoutRedirectPending = localStorage.getItem('didiRedirectPending') === 'true' || localStorage.getItem('didiTriggerLogin') === 'true';
        if (isCheckoutRedirectPending) {
            window.location.reload(); 
        }
    } catch(e) {
        console.error("Native login failed", e);
        if (typeof showToast === 'function') showToast("Native login failed: " + e.message, "error");
        else alert("Native login failed: " + e.message);
    }
};

window.handleNativeGoogleSignInError = (errorMsg) => {
    if (typeof showToast === 'function') showToast("Google Sign-In cancelled or failed", "error");
    else console.warn("Google Sign-In failed: " + errorMsg);
};

window.handleNativeFCMToken = async (token) => {
    if (!token) return;
    try {
        if (currentUser) {
            await setDoc(doc(db, "users", currentUser.uid), {
                fcmToken: token
            }, { merge: true });
            console.log("Native FCM Token saved to user profile.");
        } else {
            // Save to localStorage so it can be saved on next login
            localStorage.setItem('pendingFcmToken', token);
        }
    } catch(e) {
        console.error("Failed to save native FCM token:", e);
    }
};

window.handleLogout = async () => {
    await signOut(auth);
    window.location.reload();
};

// --- Customer Chat Logic ---
let currentActiveOrderId = null;
let currentActiveOrderNumber = null;

window.toggleCustomerChat = async () => {
    const windowEl = document.getElementById('customer-chat-window');
    if (!windowEl) return;
    
    if (windowEl.classList.contains('hidden')) {
        windowEl.classList.remove('hidden');
        windowEl.classList.add('flex');
        
        // Hide badge when opened
        const badge = document.getElementById('chat-unread-badge');
        if (badge) badge.classList.add('hidden');
        
        // Scroll to bottom
        const messagesContainer = document.getElementById('customer-chat-messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    } else {
        windowEl.classList.add('hidden');
        windowEl.classList.remove('flex');
    }
};

let globalChatInitialLoad = true;

window.initGlobalChatListener = async (user) => {
    if (customerChatUnsubscribe) {
        customerChatUnsubscribe();
        customerChatUnsubscribe = null;
    }
    
    // Fetch active order
    const q = query(collection(db, "orders"), where("userId", "==", user.uid));
    const snapshot = await getDocs(q);
    
    let latestActiveOrder = null;
    let latestRecentOrder = null;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const orderDate = new Date(data.timestamp);
        
        if (!['Delivered', 'Collected', 'Rejected'].includes(data.status)) {
            if (!latestActiveOrder || orderDate > new Date(latestActiveOrder.timestamp)) {
                latestActiveOrder = { id: doc.id, ...data };
            }
        } else {
            // Include recent completed orders within 7 days
            if (orderDate >= sevenDaysAgo) {
                if (!latestRecentOrder || orderDate > new Date(latestRecentOrder.timestamp)) {
                    latestRecentOrder = { id: doc.id, ...data };
                }
            }
        }
    });

    // Prioritize active order, fallback to recent completed order
    latestActiveOrder = latestActiveOrder || latestRecentOrder;

    const messagesContainer = document.getElementById('customer-chat-messages');
    const inputField = document.getElementById('customer-chat-input');
    if (!messagesContainer || !inputField) return;

    if (!latestActiveOrder) {
        messagesContainer.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-brand-white/30 text-sm p-6 text-center">
                <i data-lucide="message-square" class="w-12 h-12 mb-4 opacity-50"></i>
                Live chat is only available while you have an active ongoing order.
            </div>
        `;
        inputField.disabled = true;
        inputField.placeholder = "No active orders...";
        if(window.lucide) lucide.createIcons();
        return;
    }

    currentActiveOrderId = latestActiveOrder.id;
    currentActiveOrderNumber = latestActiveOrder.orderNumber;
    
    const isCompleted = ['Delivered', 'Collected', 'Rejected'].includes(latestActiveOrder.status);
    if (isCompleted) {
        inputField.disabled = true;
        inputField.placeholder = "Chat closed for completed orders.";
    } else {
        inputField.disabled = false;
        inputField.placeholder = "Type your message...";
    }
    
    globalChatInitialLoad = true;
    
    customerChatUnsubscribe = onSnapshot(query(collection(db, "messages"), where("customerId", "==", user.uid)), (snap) => {
        // Notification Logic for New Messages
        snap.docChanges().forEach(change => {
            if (change.type === 'added') {
                const data = change.doc.data();
                if (data.orderId === currentActiveOrderId && data.sender === 'Admin' && !globalChatInitialLoad) {
                    // Play sound
                    try {
                        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                        audio.volume = 0.5;
                        audio.play();
                    } catch(e) {}
                    
                    // Show notification badge if chat is hidden
                    const windowEl = document.getElementById('customer-chat-window');
                    if (windowEl && windowEl.classList.contains('hidden')) {
                        const badge = document.getElementById('chat-unread-badge');
                        if (badge) badge.classList.remove('hidden');
                        if (typeof showToast === 'function') showToast("New message from Support!", "info");
                    }
                }
            }
        });

        // Re-render chat UI
        let msgs = [];
        snap.forEach(doc => {
            const data = doc.data();
            if(data.orderId === currentActiveOrderId) {
                msgs.push({ id: doc.id, ...data });
            }
        });
        
        msgs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        messagesContainer.innerHTML = `
            <div class="flex items-end gap-2">
                <div class="w-6 h-6 rounded-full bg-brand-gold flex flex-shrink-0 items-center justify-center">
                    <i data-lucide="headset" class="w-3 h-3 text-black"></i>
                </div>
                <div class="bg-white/10 border border-white/5 text-brand-white px-3 py-2 rounded-2xl rounded-tl-none text-xs">
                    Hi there! 👋 How can we help you with order #${currentActiveOrderNumber ? String(currentActiveOrderNumber).padStart(5, '0') : currentActiveOrderId.substring(0,6).toUpperCase()}?
                </div>
            </div>
        `;

        msgs.forEach(m => {
            const timeStr = new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            const isCustomer = m.sender === 'Customer';
            
            if (isCustomer) {
                messagesContainer.innerHTML += `
                    <div class="flex justify-end mb-2">
                        <div class="max-w-[80%]">
                            <div class="bg-brand-gold text-black px-3 py-2 rounded-2xl rounded-tr-none text-xs mb-1">
                                ${m.text}
                            </div>
                            <div class="text-[9px] text-brand-white/40 text-right">${timeStr}</div>
                        </div>
                    </div>
                `;
            } else {
                messagesContainer.innerHTML += `
                    <div class="flex items-end gap-2 mb-2">
                        <div class="w-6 h-6 rounded-full bg-brand-gold flex flex-shrink-0 items-center justify-center">
                            <i data-lucide="headset" class="w-3 h-3 text-black"></i>
                        </div>
                        <div class="max-w-[80%]">
                            <div class="bg-white/10 border border-white/5 text-brand-white px-3 py-2 rounded-2xl rounded-tl-none text-xs mb-1">
                                ${m.text}
                            </div>
                            <div class="text-[9px] text-brand-white/40 ml-1">${timeStr}</div>
                        </div>
                    </div>
                `;
            }
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if(window.lucide) lucide.createIcons();
        
        globalChatInitialLoad = false;
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('customer-chat-form');
    if(chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('customer-chat-input');
            const text = input.value.trim();
            if (!text || !currentUser || !currentActiveOrderId) return;
            
            input.value = '';
            
            await addDoc(collection(db, "messages"), {
                customerId: currentUser.uid,
                customerName: currentUser.displayName || 'Customer',
                orderId: currentActiveOrderId,
                sender: 'Customer',
                text: text,
                timestamp: new Date().toISOString()
            });
        });
    }
});

async function loadActiveCoupons() {
    try {
        const q = query(collection(db, "coupons"), where("isActive", "==", true));
        const snapshot = await getDocs(q);
        activeCoupons = [];
        snapshot.forEach(docSnap => {
            activeCoupons.push({ id: docSnap.id, ...docSnap.data() });
        });
    } catch(e) {
        console.error("Error loading active coupons", e);
    }
}

function getDiscountLabel(coupon) {
    if (!coupon) return null;
    if (coupon.type === 'percent') {
        return `${coupon.value}% OFF`;
    } else if (coupon.type === 'fixed') {
        return `₹${coupon.value} OFF`;
    } else if (coupon.type === 'bogo') {
        return `BUY 1 GET 1 FREE`;
    } else if (coupon.type === 'free_delivery') {
        return `FREE DELIVERY`;
    }
    return null;
}

function getDealTextForItem(item) {
    // 1. Find coupon specifically targeting this item
    const specificCoupon = activeCoupons.find(c => c.isActive && c.targetType === 'specific_item' && c.targetItemId === item.id);
    if (specificCoupon) {
        return getDiscountLabel(specificCoupon);
    }

    // 2. Otherwise, find a general active coupon
    const generalCoupon = activeCoupons.find(c => c.isActive && c.targetType !== 'specific_item');
    if (generalCoupon) {
        return getDiscountLabel(generalCoupon);
    }

    return null;
}

// Load Menu Items from Firestore
async function loadMenu() {
    const menuGrid = document.getElementById('menu-grid');
    if (!menuGrid) return;
    try {
        await loadActiveCoupons();
        
        onSnapshot(collection(db, "menu"), (querySnapshot) => {
            menuGrid.innerHTML = ''; 
            allMenuItems = []; // Clear array to prevent duplicates
            
            if (querySnapshot.empty) {
                menuGrid.innerHTML = '<p class="text-brand-white/50 col-span-full text-center">No items found. Add some from the Admin Panel.</p>';
                return;
            }

            querySnapshot.forEach((doc) => {
                const item = doc.data();
                const status = item.status || (item.isAvailable === false ? 'Offline' : 'Available');
                
                // Only add items that are explicitly Available or Out of Stock. Hide Offline completely.
                if (status !== 'Offline') {
                    item.id = doc.id;
                    item.status = status;
                    allMenuItems.push(item);
                }
            });

            // Self-heal cart items with missing properties (like isVeg) AND sync live prices from database
            let cartUpdated = false;
            cart.forEach(cartItem => {
                const menuItem = allMenuItems.find(m => m.id === cartItem.id || m.name === cartItem.name);
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
                updateCartUI();
            }

            // Maintain current filter if possible, otherwise render all
            const currentFilterBtn = document.querySelector('.category-btn.bg-brand-gold');
            if (currentFilterBtn && currentFilterBtn.dataset.category !== 'All') {
                window.filterMenu(currentFilterBtn.dataset.category);
            } else {
                renderMenuItems(allMenuItems);
            }
            
            renderRecommendedCarousel();
        });
        
    } catch (e) {
        console.error("Error loading menu: ", e);
        menuGrid.innerHTML = '<p class="text-brand-red col-span-full text-center font-bold">Error loading menu. Did you configure Firebase in js/firebase-config.js?</p>';
    }
}

function renderMenuItems(items) {
    const menuGrid = document.getElementById('menu-grid');
    if (!menuGrid) return;
    
    const resultsCountEl = document.getElementById('results-count');
    if (resultsCountEl) resultsCountEl.innerText = items.length;
    
    menuGrid.innerHTML = '';
    
    if (items.length === 0) {
        menuGrid.innerHTML = `
            <div class="text-brand-white/40 col-span-full text-center py-20 flex flex-col items-center justify-center gap-4">
                <i data-lucide="search-code" class="w-12 h-12 opacity-50 text-brand-gold"></i>
                <p class="font-bold text-lg">No dishes found matching your selection.</p>
                <button onclick="toggleFilter('all')" class="px-5 py-2 bg-brand-gold text-black text-xs font-black rounded-xl hover:bg-white transition-colors uppercase tracking-widest">
                    Clear Filters
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }
    
    // 1. Group items by category
    const groupedItems = {};
    items.forEach(item => {
        const cat = item.category || 'Other';
        if (!groupedItems[cat]) groupedItems[cat] = [];
        groupedItems[cat].push(item);
    });
    
    // 2. Sort categories based on User Preferences or Default
    let sortedCategories = Object.keys(groupedItems);
    
    const sortSelect = document.getElementById('sort-select');
    const sortValue = sortSelect ? sortSelect.value : 'recommended';

    if (sortValue === 'recommended' && userCategoryPrefs.length > 0) {
        sortedCategories.sort((a, b) => {
            const indexA = userCategoryPrefs.indexOf(a);
            const indexB = userCategoryPrefs.indexOf(b);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.localeCompare(b);
        });
    } else {
        sortedCategories.sort();
    }
    
    // 3. Render Grouped Categories
    sortedCategories.forEach(category => {
        let categoryItems = groupedItems[category];
        if (!categoryItems || categoryItems.length === 0) return;
        
        // Apply Sort By Dropdown internally to the category items
        if (sortValue === 'price_low') {
            categoryItems.sort((a, b) => Number(a.price) - Number(b.price));
        } else if (sortValue === 'price_high') {
            categoryItems.sort((a, b) => Number(b.price) - Number(a.price));
        } else if (sortValue === 'name_asc') {
            categoryItems.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        // Category Header
        const header = document.createElement('div');
        header.className = 'col-span-full mt-6 mb-2 border-b border-white/10 pb-3';
        header.innerHTML = `<h3 class="text-xl font-black text-brand-white uppercase tracking-wider">${category}</h3>`;
        menuGrid.appendChild(header);
        
        // Category Grid Container
        const gridContainer = document.createElement('div');
        gridContainer.className = 'col-span-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-6';
        
        categoryItems.forEach(item => {
            gridContainer.appendChild(createItemCard(item));
        });
        
        menuGrid.appendChild(gridContainer);
    });

    if (window.lucide) lucide.createIcons();
    if (typeof window.observeNewElements === 'function') window.observeNewElements();
}

function createItemCard(item) {
    const typeBadge = item.isVeg === 'true' || item.isVeg === true 
        ? `<span class="w-3.5 h-3.5 flex items-center justify-center bg-white rounded-sm border border-green-600"><span class="w-1.5 h-1.5 rounded-full bg-green-600"></span></span>`
        : `<span class="w-3.5 h-3.5 flex items-center justify-center bg-white rounded-sm border border-red-600"><span class="w-1.5 h-1.5 rounded-full bg-red-600"></span></span>`;

    // Offer tag takes priority over coupon-generated deal text
    const offerTag = item.offerTag || null;
    const dealText = offerTag || getDealTextForItem(item);

    // Strikethrough original price
    const originalPriceHtml = item.originalPrice ? `<span class="text-sm text-brand-white/40 line-through mr-1">₹${item.originalPrice}</span>` : '';
    
    // Quantity / Serving label
    const qtyLabelHtml = item.quantityLabel ? `<span class="text-[10px] text-brand-gold font-bold uppercase tracking-wider">${item.quantityLabel}</span>` : '';

    // Preparation / Delivery time
    let deliveryTime = item.prepTime || null;
    if (!deliveryTime) {
        // Fallback to old logic if prepTime is not explicitly set in Admin Panel
        deliveryTime = "25-30 mins";
        const cat = (item.category || '').toLowerCase();
        if (cat.includes('biryani')) {
            deliveryTime = "35-40 mins";
        } else if (cat.includes('thali') || cat.includes('combo')) {
            deliveryTime = "40-45 mins";
        } else if (cat.includes('drink') || cat.includes('beverage')) {
            deliveryTime = "15-20 mins";
        }
    }

    const card = document.createElement('div');
    card.className = 'group menu-card-premium bg-[#121212] border border-white/5 hover:border-brand-gold/30 hover:bg-[#161616] rounded-3xl overflow-hidden transition-all duration-300 flex flex-col relative shadow-[0_4px_20px_rgba(0,0,0,0.25)] hover:shadow-[0_4px_30px_rgba(212, 160, 23,0.1)]';
    card.innerHTML = `
        <div class="relative w-full h-48 overflow-hidden bg-black/10 ${item.status === 'Out of Stock' ? '' : 'cursor-pointer'}" ${item.status === 'Out of Stock' ? '' : `onclick="openCustomizationModal('${item.id}')"`}>
            <img src="${item.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=600'}" class="object-cover w-full h-full ${item.status === 'Out of Stock' ? 'opacity-40 grayscale' : 'group-hover:scale-105'} transition-transform duration-700">
            
            <div class="absolute top-4 left-4 z-10 bg-black/40 backdrop-blur-md p-1.5 rounded-lg border border-white/10">
                ${typeBadge}
            </div>

            ${dealText && item.status !== 'Out of Stock' 
                ? `<div class="absolute bottom-4 left-4 bg-brand-red text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg shadow-[0_4px_10px_rgba(193,18,31,0.3)] animate-pulse">
                       ${dealText}
                   </div>`
                : ''
            }
            
            <button class="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/50 hover:bg-brand-red hover:text-white hover:border-transparent border border-white/10 transition-all z-10" onclick="event.stopPropagation();">
                <i data-lucide="heart" class="w-4 h-4"></i>
            </button>
        </div>
        
        <div class="p-5 flex flex-col flex-grow">
            <div class="flex justify-between items-start gap-2 mb-2 ${item.status === 'Out of Stock' ? '' : 'cursor-pointer'}" ${item.status === 'Out of Stock' ? '' : `onclick="openCustomizationModal('${item.id}')"`}>
                <h3 class="text-base font-black text-brand-white truncate flex-1 group-hover:text-brand-gold transition-colors ${item.status === 'Out of Stock' ? 'opacity-50' : ''}">${item.name}</h3>
                
                <span class="flex items-center gap-0.5 bg-green-600/20 text-green-500 px-1.5 py-0.5 rounded text-[10px] font-black">
                    ${item.rating || '4.5'} <i data-lucide="star" class="w-2.5 h-2.5 fill-current"></i>
                </span>
            </div>

            <p class="text-xs text-brand-white/40 line-clamp-2 mb-4 leading-relaxed flex-grow">
                ${item.description || 'Delectable and freshly prepared, cooked to order with authentic spices.'}
            </p>

            <div class="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
                <div class="flex flex-col">
                    <span class="text-xs text-brand-white/40 font-bold uppercase tracking-wider">${deliveryTime}</span>
                    <div class="flex items-center gap-1 mt-0.5">
                        ${originalPriceHtml}
                        <span class="text-xl font-black text-brand-white">₹${item.price}</span>
                    </div>
                    ${qtyLabelHtml}
                </div>
                
                ${(() => {
                    const qtyInCart = cart.filter(i => i.id === item.id).reduce((s, i) => s + i.quantity, 0);
                    if (item.status === 'Out of Stock') {
                        return `<span class="px-4 py-2 bg-white/5 text-brand-white/40 font-black text-xs rounded-xl uppercase tracking-wider cursor-not-allowed">SOLD OUT</span>`;
                    } else if (qtyInCart > 0) {
                        return `
                            <div class="flex items-center gap-3 bg-brand-gold/10 border border-brand-gold/30 rounded-xl px-2 py-1 shadow-[0_0_10px_rgba(212,160,23,0.1)]">
                                <button onclick="decrementFromHome('${item.id}')" class="text-brand-white/60 hover:text-brand-gold text-sm font-black px-2 py-1">-</button>
                                <span class="text-brand-gold font-bold text-xs w-3 text-center">${qtyInCart}</span>
                                <button onclick="incrementFromHome('${item.id}')" class="text-brand-white/60 hover:text-brand-gold text-sm font-black px-2 py-1">+</button>
                            </div>
                        `;
                    } else {
                        return `<button onclick="openCustomizationModal('${item.id}')" class="add-to-cart-btn px-4 py-2 border border-brand-gold text-brand-gold bg-brand-gold/5 hover:bg-brand-gold hover:text-black font-black text-xs rounded-xl transition-all shadow-[0_0_10px_rgba(212, 160, 23,0.1)] uppercase tracking-wider">+ ADD</button>`;
                    }
                })()}
            </div>
        </div>
    `;
    return card;
}

window.filterByCategory = (category) => {
    currentCategoryFilter = category;
    
    // Update menu title
    const menuTitle = document.getElementById('menu-section-title');
    if (menuTitle) {
        menuTitle.innerText = category === 'All' ? 'Menu to explore' : `${category} Menu`;
    }
    
    updateAllPillState();
    applyFiltersAndSort();
    
    // Scroll down to menu section
    const menuSection = document.getElementById('menu-section');
    if(menuSection) menuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function applyFiltersAndSort() {
    let itemsToRender = allMenuItems;
    
    // Category filter
    if (currentCategoryFilter !== 'All') {
        itemsToRender = itemsToRender.filter(i => {
            const itemCat = (i.category || '').trim().toLowerCase();
            const filterCat = currentCategoryFilter.trim().toLowerCase();
            return itemCat === filterCat;
        });
    }
    
    // Veg Only filter
    if (vegOnlyFilter) {
        itemsToRender = itemsToRender.filter(i => i.isVeg === 'true' || i.isVeg === true);
    }
    
    // Rating filter (4.0+)
    if (ratingFilter) {
        itemsToRender = itemsToRender.filter(i => Number(i.rating || 4.5) >= 4.0);
    }
    
    // Price filter (Under 150)
    if (under150Filter) {
        itemsToRender = itemsToRender.filter(i => Number(i.price) < 150);
    }
    
    // Search filter
    if (searchQuery.trim() !== '') {
        const queryText = searchQuery.toLowerCase().trim();
        itemsToRender = itemsToRender.filter(i => 
            i.name.toLowerCase().includes(queryText) || 
            (i.category && i.category.toLowerCase().includes(queryText)) ||
            (i.description && i.description.toLowerCase().includes(queryText))
        );
    }
    
    renderMenuItems(itemsToRender);
    renderRecommendedCarousel();
}

// Sort Dropdown Filtering
const sortSelectEl = document.getElementById('sort-select');
if (sortSelectEl) {
    sortSelectEl.addEventListener('change', () => {
        applyFiltersAndSort();
    });
}

// Customization Modal Logic
let currentFood = null;
let currentQty = 1;
let selectedVariantPrice = null; // Tracks selected variant's price

window.openCustomizationModal = (id) => {
    currentFood = allMenuItems.find(i => i.id === id);
    if(!currentFood) return;

    currentQty = 1;
    selectedVariantPrice = null;
    document.getElementById('cust-qty').innerText = currentQty;
    document.getElementById('cust-img').src = currentFood.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=600';
    document.getElementById('cust-title').innerText = currentFood.name;
    document.getElementById('cust-desc').innerText = currentFood.description;
    
    const optionsContainer = document.getElementById('cust-options-container');
    optionsContainer.innerHTML = '';

    // Show offer tag & description in modal if present
    if (currentFood.offerTag || currentFood.offerDescription || currentFood.quantityLabel) {
        let offerHtml = '<div class="mb-4 p-3 rounded-xl bg-brand-red/10 border border-brand-red/20">';
        if (currentFood.offerTag) {
            offerHtml += `<span class="inline-block px-2.5 py-1 bg-brand-red text-white text-[10px] font-black uppercase tracking-widest rounded-lg mr-2">${currentFood.offerTag}</span>`;
        }
        if (currentFood.quantityLabel) {
            offerHtml += `<span class="inline-block px-2 py-0.5 bg-brand-gold/20 text-brand-gold text-[10px] font-bold rounded">${currentFood.quantityLabel}</span>`;
        }
        if (currentFood.offerDescription) {
            offerHtml += `<p class="text-xs text-brand-white/60 mt-2">${currentFood.offerDescription}</p>`;
        }
        offerHtml += '</div>';
        optionsContainer.innerHTML += offerHtml;
    }

    // Show original price crossed out in modal
    if (currentFood.originalPrice) {
        optionsContainer.innerHTML += `
            <div class="flex items-center gap-2 mb-4 text-sm">
                <span class="text-brand-white/40 line-through">₹${currentFood.originalPrice}</span>
                <span class="text-brand-gold font-black">₹${currentFood.price}</span>
                <span class="px-2 py-0.5 bg-green-500/20 text-green-500 text-[10px] font-black rounded">${Math.round(((currentFood.originalPrice - currentFood.price) / currentFood.originalPrice) * 100)}% OFF</span>
            </div>
        `;
    }

    // Render variant selection (Half Plate / Full Plate etc) BEFORE customizations
    if (currentFood.variants && currentFood.variants.length > 0) {
        let variantHtml = `<div class="cust-group variant-selection-group mb-4" data-group-name="Size">
            <h4 class="text-brand-white font-bold mb-3 flex items-center gap-2">
                <i data-lucide="ruler" class="w-4 h-4 text-brand-gold"></i> Choose Size / Portion
            </h4>
            <div class="space-y-2">`;
        
        currentFood.variants.forEach((v, idx) => {
            variantHtml += `
                <label class="flex items-center justify-between p-3 rounded-xl border border-white/10 hover:bg-white/5 cursor-pointer transition-colors ${idx === 0 ? 'border-brand-gold/50 bg-brand-gold/5' : ''}">
                    <div class="flex items-center gap-3">
                        <input type="radio" name="variant-select" value="${idx}" data-variant-price="${v.price}" data-variant-label="${v.label}" class="variant-radio accent-brand-gold w-4 h-4" onchange="selectVariant(this)" ${idx === 0 ? 'checked' : ''}>
                        <span class="text-sm text-brand-white/80 font-bold">${v.label}</span>
                    </div>
                    <span class="text-sm font-black text-brand-gold">₹${v.price}</span>
                </label>
            `;
        });
        variantHtml += `</div></div>`;
        optionsContainer.innerHTML += variantHtml;
        
        // Default select first variant
        selectedVariantPrice = currentFood.variants[0].price;
    }

    if (currentFood.customizations && currentFood.customizations.length > 0) {
        currentFood.customizations.forEach((group, gIdx) => {
            let html = `<div class="cust-group" data-group-name="${group.name}">
                <h4 class="text-brand-white font-bold mb-3">${group.name}</h4>
                <div class="space-y-2">`;
            
            group.options.forEach((opt, oIdx) => {
                html += `
                    <div class="flex items-center justify-between p-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors">
                        <div class="flex items-center gap-3">
                            <div class="flex items-center gap-2 bg-brand-black border border-white/20 rounded-lg p-1">
                                <button type="button" onclick="updateCustQty(this, -1)" class="w-6 h-6 rounded bg-brand-gold text-brand-black flex items-center justify-center font-bold hover:bg-white transition-colors">-</button>
                                <span class="cust-qty text-brand-white font-bold w-4 text-center text-xs" data-name="${opt.name}" data-price="${opt.price}">0</span>
                                <button type="button" onclick="updateCustQty(this, 1)" class="w-6 h-6 rounded bg-brand-gold text-brand-black flex items-center justify-center font-bold hover:bg-white transition-colors">+</button>
                            </div>
                            <span class="text-sm text-brand-white/80 font-medium ml-1">${opt.name}</span>
                        </div>
                        <span class="text-sm text-brand-white/50 font-bold">${opt.price > 0 ? '+₹'+opt.price : 'Free'}</span>
                    </div>
                `;
            });
            html += `</div></div>`;
            optionsContainer.innerHTML += html;
        });
    }

    calculateCustTotal();
    document.getElementById('customization-modal').classList.remove('hidden');
    document.getElementById('customization-modal').classList.add('flex');
    if (window.lucide) lucide.createIcons();
};

window.updateCustQty = (btn, delta) => {
    const span = btn.parentElement.querySelector('.cust-qty');
    let qty = parseInt(span.innerText) || 0;
    qty += delta;
    if (qty < 0) qty = 0;
    span.innerText = qty;
    
    // Highlight the row if qty > 0
    const row = btn.closest('.border-white\\/10');
    if (row) {
        if (qty > 0) {
            row.classList.add('bg-brand-gold/10', 'border-brand-gold/50');
            row.classList.remove('hover:bg-white/5');
        } else {
            row.classList.remove('bg-brand-gold/10', 'border-brand-gold/50');
            row.classList.add('hover:bg-white/5');
        }
    }
    calculateCustTotal();
};

window.selectVariant = (radio) => {
    selectedVariantPrice = Number(radio.getAttribute('data-variant-price'));
    
    // Update visual highlight on variant labels
    document.querySelectorAll('.variant-selection-group label').forEach(label => {
        label.classList.remove('border-brand-gold/50', 'bg-brand-gold/5');
        label.classList.add('border-white/10');
    });
    const parentLabel = radio.closest('label');
    if (parentLabel) {
        parentLabel.classList.add('border-brand-gold/50', 'bg-brand-gold/5');
        parentLabel.classList.remove('border-white/10');
    }
    
    calculateCustTotal();
};

window.closeCustomizationModal = () => {
    document.getElementById('customization-modal').classList.add('hidden');
    document.getElementById('customization-modal').classList.remove('flex');
};

window.updateQty = (change) => {
    if(currentQty + change >= 1) {
        currentQty += change;
        document.getElementById('cust-qty').innerText = currentQty;
        calculateCustTotal();
    }
};

window.calculateCustTotal = () => {
    let base = selectedVariantPrice !== null ? selectedVariantPrice : Number(currentFood.price);
    let addons = 0;
    document.querySelectorAll('.cust-qty').forEach(span => {
        const qty = parseInt(span.innerText) || 0;
        if (qty > 0) {
            addons += (Number(span.getAttribute('data-price')) * qty);
        }
    });
    
    const finalPrice = (base + addons) * currentQty;
    document.getElementById('cust-total').innerText = '₹' + finalPrice;
    return finalPrice;
};

window.confirmAddToCart = () => {
    const selectedCustomizations = {};
    const addonDetails = [];
    let addonsCost = 0;
    
    document.querySelectorAll('.cust-group:not(.variant-selection-group)').forEach(groupDiv => {
        const groupName = groupDiv.getAttribute('data-group-name');
        const activeQtys = Array.from(groupDiv.querySelectorAll('.cust-qty')).filter(span => parseInt(span.innerText) > 0);
        
        if(activeQtys.length > 0) {
            const selectedNames = [];
            activeQtys.forEach(span => {
                const qty = parseInt(span.innerText);
                const name = span.getAttribute('data-name');
                const unitPrice = Number(span.getAttribute('data-price'));
                
                const formattedName = qty > 1 ? `${name} (x${qty})` : name;
                selectedNames.push(formattedName);
                
                const totalAddonPrice = unitPrice * qty;
                addonsCost += totalAddonPrice;
                addonDetails.push({ name: formattedName, price: totalAddonPrice, quantity: qty });
            });
            selectedCustomizations[groupName] = selectedNames.join(', ');
        }
    });

    // Determine base price from variant or item
    const basePrice = selectedVariantPrice !== null ? selectedVariantPrice : Number(currentFood.price);
    const itemPrice = basePrice + addonsCost;

    // Get selected variant label
    let selectedVariantLabel = null;
    const checkedVariant = document.querySelector('.variant-radio:checked');
    if (checkedVariant) {
        selectedVariantLabel = checkedVariant.getAttribute('data-variant-label');
    }

    cart.push({
        id: currentFood.id,
        name: currentFood.name,
        price: itemPrice,
        quantity: currentQty,
        customizations: selectedCustomizations,
        addonDetails: addonDetails,
        image: currentFood.image,
        category: currentFood.category,
        isVeg: currentFood.isVeg,
        originalPrice: currentFood.originalPrice ? Number(currentFood.originalPrice) : null,
        variantLabel: selectedVariantLabel,
        quantityLabel: currentFood.quantityLabel || null
    });
    
    total += (itemPrice * currentQty);
    updateCartUI();
    closeCustomizationModal();
};

window.lastAttemptedRepeatItemId = null;

window.incrementFromHome = (itemId) => {
    event.stopPropagation();
    // Find all occurrences of this item in the cart
    const itemInCartMatches = cart.filter(i => i.id === itemId);
    
    // If it has customizations, ask to repeat
    const hasCustomizations = itemInCartMatches.some(i => i.customizations && Object.keys(i.customizations).length > 0);
    
    if (hasCustomizations) {
        window.lastAttemptedRepeatItemId = itemId;
        const modal = document.getElementById('repeat-customization-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            if(window.lucide) lucide.createIcons();
        }
    } else {
        // Just increment the last one found
        const lastIndex = cart.findLastIndex(i => i.id === itemId);
        if (lastIndex !== -1) {
            cart[lastIndex].quantity += 1;
            updateCartUI();
        } else {
            // Fallback just in case
            openCustomizationModal(itemId);
        }
    }
};

window.decrementFromHome = (itemId) => {
    event.stopPropagation();
    // Decrement the LAST added instance of this item
    const lastIndex = cart.findLastIndex(i => i.id === itemId);
    if (lastIndex !== -1) {
        cart[lastIndex].quantity -= 1;
        if (cart[lastIndex].quantity <= 0) {
            cart.splice(lastIndex, 1);
        }
        updateCartUI();
    }
};

window.closeRepeatCustomizationModal = () => {
    const modal = document.getElementById('repeat-customization-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.confirmRepeatCustomization = () => {
    if (window.lastAttemptedRepeatCartIndex !== null && window.lastAttemptedRepeatCartIndex !== undefined) {
        const idx = window.lastAttemptedRepeatCartIndex;
        if (cart[idx]) {
            cart[idx].quantity += 1;
            updateCartUI();
            if (typeof renderCartPreviewItems === 'function') renderCartPreviewItems();
        }
    } else if (window.lastAttemptedRepeatItemId) {
        const lastIndex = cart.findLastIndex(i => i.id === window.lastAttemptedRepeatItemId);
        if (lastIndex !== -1) {
            cart[lastIndex].quantity += 1;
            updateCartUI();
        }
    }
    window.lastAttemptedRepeatCartIndex = null;
    window.lastAttemptedRepeatItemId = null;
    closeRepeatCustomizationModal();
};

window.openNewCustomizationFromRepeat = () => {
    let id = null;
    if (window.lastAttemptedRepeatCartIndex !== null && window.lastAttemptedRepeatCartIndex !== undefined) {
        id = cart[window.lastAttemptedRepeatCartIndex].id;
    } else if (window.lastAttemptedRepeatItemId) {
        id = window.lastAttemptedRepeatItemId;
    }
    
    window.lastAttemptedRepeatCartIndex = null;
    window.lastAttemptedRepeatItemId = null;
    closeRepeatCustomizationModal();
    
    if (id) {
        openCustomizationModal(id);
    }
};

function updateCartUI() {
    localStorage.setItem('didisCart', JSON.stringify(cart));
    
    const countM = document.getElementById('cart-count-mobile');
    const countD = document.getElementById('cart-count-desktop');
    const totalQty = cart.reduce((s, i) => s + i.quantity, 0);
    const totalAmt = cart.reduce((s, i) => s + (i.price * i.quantity), 0);

    // Update floating bottom bar count and text
    const badge = document.getElementById('floating-cart-badge');
    const summary = document.getElementById('floating-cart-summary');
    const drawer = document.getElementById('floating-cart-drawer');

    if (badge) badge.innerText = totalQty;
    if (summary) summary.innerText = `₹${totalAmt.toFixed(2)}`;
    
    if (cart.length > 0) {
        if (countM) {
            countM.classList.remove('hidden');
            countM.innerText = totalQty;
        }
        if (countD) {
            countD.classList.remove('hidden');
            countD.innerText = totalQty;
        }
        if (drawer) {
            drawer.classList.remove('translate-y-full');
            drawer.classList.add('translate-y-0');
        }
    } else {
        if (countM) countM.classList.add('hidden');
        if (countD) countD.classList.add('hidden');
        if (drawer) {
            drawer.classList.remove('translate-y-0');
            drawer.classList.add('translate-y-full');
        }
    }
    
    if (typeof renderCartPreviewItems === 'function') {
        renderCartPreviewItems();
    }
    
    // Re-render menu to update the [+] and [-] buttons dynamically
    if (typeof applyFiltersAndSort === 'function') {
        applyFiltersAndSort();
    }
}

// Recommended Deals Carousel Renderer
function renderRecommendedCarousel() {
    const section = document.getElementById('recommended-deals-section');
    const carousel = document.getElementById('recommended-carousel');
    if (!carousel || !section) return;

    if (allMenuItems.length === 0) {
        section.classList.add('hidden');
        return;
    }

    // Apply veg-only filter if active
    let baseItems = vegOnlyFilter ? allMenuItems.filter(i => i.isVeg === 'true' || i.isVeg === true) : allMenuItems;

    // Determine recommendations
    let recs = [];
    if (currentUser && userCategoryPrefs.length > 0) {
        // Prioritize items in user's favorite categories
        const favCats = userCategoryPrefs.slice(0, 2);
        recs = baseItems.filter(item => favCats.includes(item.category || ''));
        // Fallback or fill with high rated items if not enough items
        if (recs.length < 4) {
            const highRated = baseItems
                .filter(item => !recs.some(r => r.id === item.id))
                .sort((a, b) => Number(b.rating || 4.5) - Number(a.rating || 4.5));
            recs = recs.concat(highRated);
        }
    } else {
        // Just sort by highest rating
        recs = [...baseItems].sort((a, b) => Number(b.rating || 4.5) - Number(a.rating || 4.5));
    }

    // Keep only 4 to 6 items
    recs = recs.slice(0, 6);

    if (recs.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    carousel.innerHTML = '';

    recs.forEach((item, index) => {
        const offerTag = item.offerTag || null;
        const dealText = offerTag || getDealTextForItem(item);
        const rating = item.rating || '4.5';
        const deliveryTime = (25 + (index * 5)) + " mins";
        const typeBadge = item.isVeg === 'true' || item.isVeg === true 
            ? `<span class="w-3.5 h-3.5 flex items-center justify-center bg-white rounded-sm border border-green-600"><span class="w-1.5 h-1.5 rounded-full bg-green-600"></span></span>`
            : `<span class="w-3.5 h-3.5 flex items-center justify-center bg-white rounded-sm border border-red-600"><span class="w-1.5 h-1.5 rounded-full bg-red-600"></span></span>`;

        const originalPriceHtml = item.originalPrice ? `<span class="text-xs text-brand-white/40 line-through mr-1">₹${item.originalPrice}</span>` : '';
        const qtyLabelHtml = item.quantityLabel ? `<div class="text-[9px] text-brand-gold font-bold uppercase tracking-wider">${item.quantityLabel}</div>` : '';

        const card = document.createElement('div');
        card.className = 'snap-start flex-shrink-0 w-64 md:w-72 menu-card-premium bg-[#141414] border border-white/10 hover:border-brand-gold/50 rounded-2xl overflow-hidden transition-all duration-300 flex flex-col group';
        card.innerHTML = `
            <div class="relative h-40 w-full overflow-hidden p-2 bg-black/20 ${item.status === 'Out of Stock' ? '' : 'cursor-pointer'}" ${item.status === 'Out of Stock' ? '' : `onclick="openCustomizationModal('${item.id}')"`}>
                <img src="${item.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=600'}" class="object-cover w-full h-full rounded-xl ${item.status === 'Out of Stock' ? 'opacity-50' : 'group-hover:scale-105'} transition-transform duration-700">
                ${dealText 
                    ? `<div class="absolute bottom-4 left-4 bg-brand-red text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-md animate-pulse">
                           ${dealText}
                       </div>`
                    : ''
                }
                <div class="absolute top-4 left-4 z-10 bg-black/40 backdrop-blur-md p-1.5 rounded-lg border border-white/10">
                    ${typeBadge}
                </div>
            </div>
            
            <div class="p-4 flex flex-col flex-grow">
                <div class="flex justify-between items-start mb-1 ${item.status === 'Out of Stock' ? '' : 'cursor-pointer'}" ${item.status === 'Out of Stock' ? '' : `onclick="openCustomizationModal('${item.id}')"`}>
                    <h4 class="font-black text-brand-white text-sm md:text-base truncate group-hover:text-brand-gold transition-colors">${item.name}</h4>
                </div>
                
                <div class="flex items-center gap-3 text-xs text-brand-white/50 mb-3 font-semibold">
                    <span class="flex items-center gap-0.5 bg-green-600/20 text-green-500 px-1.5 py-0.5 rounded text-[10px] font-black">
                        ${rating} <i data-lucide="star" class="w-2.5 h-2.5 fill-current"></i>
                    </span>
                    <span>•</span>
                    <span>${deliveryTime}</span>
                </div>
                
                <div class="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-1">
                            ${originalPriceHtml}
                            <span class="text-lg font-black text-brand-white">₹${item.price}</span>
                        </div>
                        ${qtyLabelHtml}
                    </div>
                    ${item.status === 'Out of Stock'
                        ? `<span class="text-xs text-brand-white/40 font-bold uppercase tracking-wider">Out of Stock</span>`
                        : `<button onclick="openCustomizationModal('${item.id}')" class="px-4 py-1.5 border border-brand-gold text-brand-gold bg-brand-gold/5 hover:bg-brand-gold hover:text-black font-black text-xs rounded-xl tracking-wider uppercase transition-all shadow-[0_0_10px_rgba(212, 160, 23,0.1)]">
                               + ADD
                           </button>`
                    }
                </div>
            </div>
        `;
        carousel.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
    if (typeof window.observeNewElements === 'function') window.observeNewElements();
}

function renderCartPreviewItems() {
    const container = document.getElementById('cart-preview-items');
    const subtotalEl = document.getElementById('cart-preview-subtotal');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-brand-white/30 text-sm">
                <i data-lucide="shopping-cart" class="w-12 h-12 mb-2 opacity-50 text-brand-gold"></i>
                Your cart is empty
            </div>
        `;
        if (subtotalEl) subtotalEl.innerText = '₹0.00';
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = '';
    let subtotal = 0;

    cart.forEach((item, index) => {
        subtotal += item.price * item.quantity;
        const custText = item.customizations && Object.keys(item.customizations).length > 0
            ? Object.entries(item.customizations).map(([gName, oVal]) => `${gName}: ${oVal}`).join(' | ')
            : '';

        const typeBadge = item.isVeg === 'true' || item.isVeg === true 
            ? `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-green-600 flex-shrink-0"><span class="w-1 h-1 rounded-full bg-green-600"></span></span>`
            : `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-red-600 flex-shrink-0"><span class="w-1 h-1 rounded-full bg-red-600"></span></span>`;

        const itemHtml = `
            <div class="flex items-center justify-between gap-4 p-3 rounded-2xl bg-white/5 border border-white/10">
                <div class="flex items-center gap-3 min-w-0">
                    <img src="${item.image || 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=300'}" class="w-12 h-12 object-cover rounded-xl flex-shrink-0">
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                            ${typeBadge}
                            <h4 class="font-bold text-sm text-brand-white truncate">${item.name}${item.variantLabel ? ` <span class="text-brand-gold text-[10px] font-normal">— ${item.variantLabel}</span>` : ''}</h4>
                        </div>
                        ${custText ? `<p class="text-[10px] text-brand-white/40 truncate">${custText}</p>` : ''}
                        <p class="text-xs text-brand-gold font-bold mt-1">₹${item.price} each</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1">
                        <button onclick="adjustPreviewQty(${index}, -1)" class="text-brand-white/50 hover:text-brand-gold text-xs font-bold px-1"><i data-lucide="minus" class="w-3 h-3"></i></button>
                        <span class="text-brand-white font-bold text-xs w-4 text-center">${item.quantity}</span>
                        <button onclick="adjustPreviewQty(${index}, 1)" class="text-brand-white/50 hover:text-brand-gold text-xs font-bold px-1"><i data-lucide="plus" class="w-3 h-3"></i></button>
                    </div>
                    <button onclick="adjustPreviewQty(${index}, -999)" class="text-brand-white/30 hover:text-brand-red p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </div>
            </div>
        `;
        container.innerHTML += itemHtml;
    });

    if (subtotalEl) subtotalEl.innerText = `₹${subtotal.toFixed(2)}`;
    if (window.lucide) lucide.createIcons();
}

window.lastAttemptedRepeatCartIndex = null;

window.adjustPreviewQty = (index, change) => {
    if (change === 1 && cart[index].customizations && Object.keys(cart[index].customizations).length > 0) {
        window.lastAttemptedRepeatCartIndex = index;
        window.lastAttemptedRepeatItemId = null;
        const modal = document.getElementById('repeat-customization-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            if(window.lucide) lucide.createIcons();
            return;
        }
    }

    if (change === -999) {
        cart.splice(index, 1);
    } else {
        cart[index].quantity += change;
        if (cart[index].quantity <= 0) {
            cart.splice(index, 1);
        }
    }
    updateCartUI();
    renderCartPreviewItems();
};

window.clearCartDirect = () => {
    cart = [];
    updateCartUI();
    const container = document.getElementById('cart-preview-container');
    const popup = document.getElementById('cart-preview-popup');
    if (container && popup) {
        container.classList.remove('translate-y-0');
        container.classList.add('translate-y-full');
        setTimeout(() => {
            popup.classList.add('hidden');
            popup.classList.remove('flex');
        }, 300);
    }
};

window.toggleCartPreview = () => {
    const popup = document.getElementById('cart-preview-popup');
    const container = document.getElementById('cart-preview-container');
    if (!popup || !container) return;

    if (popup.classList.contains('hidden')) {
        popup.classList.remove('hidden');
        popup.classList.add('flex');
        renderCartPreviewItems();
        setTimeout(() => {
            container.classList.remove('translate-y-full');
            container.classList.add('translate-y-0');
        }, 10);
    } else {
        container.classList.remove('translate-y-0');
        container.classList.add('translate-y-full');
        setTimeout(() => {
            popup.classList.add('hidden');
            popup.classList.remove('flex');
        }, 300);
    }
};

window.toggleVegOnly = () => {
    vegOnlyFilter = !vegOnlyFilter;
    
    const dot = document.getElementById('veg-toggle-dot');
    const btn = document.getElementById('veg-toggle-btn');
    const pillVeg = document.getElementById('filter-pill-veg');
    
    if (vegOnlyFilter) {
        if (dot) {
            dot.classList.remove('translate-x-0', 'bg-white/50');
            dot.classList.add('translate-x-5', 'bg-green-600');
        }
        if (btn) {
            btn.classList.remove('bg-white/10');
            btn.classList.add('bg-green-600/20', 'border-green-600');
        }
        if (pillVeg) {
            pillVeg.classList.add('active', 'border-brand-gold', 'text-black', 'bg-brand-gold');
            pillVeg.classList.remove('border-white/10', 'text-brand-white/70', 'bg-white/5');
        }
    } else {
        if (dot) {
            dot.classList.remove('translate-x-5', 'bg-green-600');
            dot.classList.add('translate-x-0', 'bg-white/50');
        }
        if (btn) {
            btn.classList.remove('bg-green-600/20', 'border-green-600');
            btn.classList.add('bg-white/10');
        }
        if (pillVeg) {
            pillVeg.classList.remove('active', 'border-brand-gold', 'text-black', 'bg-brand-gold');
            pillVeg.classList.add('border-white/10', 'text-brand-white/70', 'bg-white/5');
        }
    }
    
    applyFiltersAndSort();
};

window.toggleFilter = (type) => {
    const pillAll = document.getElementById('filter-pill-all');
    const pillRating = document.getElementById('filter-pill-rating');
    const pillUnder150 = document.getElementById('filter-pill-under150');
    const pillVeg = document.getElementById('filter-pill-veg');

    if (type === 'all') {
        vegOnlyFilter = false;
        ratingFilter = false;
        under150Filter = false;
        currentCategoryFilter = 'All';
        
        const dot = document.getElementById('veg-toggle-dot');
        const btn = document.getElementById('veg-toggle-btn');
        if (dot) {
            dot.classList.remove('translate-x-5', 'bg-green-600');
            dot.classList.add('translate-x-0', 'bg-white/50');
        }
        if (btn) {
            btn.classList.remove('bg-green-600/20', 'border-green-600');
            btn.classList.add('bg-white/10');
        }

        setActivePillStyle(pillAll, true);
        setActivePillStyle(pillRating, false);
        setActivePillStyle(pillUnder150, false);
        setActivePillStyle(pillVeg, false);
        
        const menuTitle = document.getElementById('menu-section-title');
        if (menuTitle) menuTitle.innerText = 'Menu to explore';
    } else if (type === 'rating') {
        ratingFilter = !ratingFilter;
        setActivePillStyle(pillRating, ratingFilter);
        updateAllPillState();
    } else if (type === 'under150') {
        under150Filter = !under150Filter;
        setActivePillStyle(pillUnder150, under150Filter);
        updateAllPillState();
    } else if (type === 'veg') {
        window.toggleVegOnly();
        updateAllPillState();
        return;
    }

    applyFiltersAndSort();
};

function setActivePillStyle(pill, isActive) {
    if (!pill) return;
    if (isActive) {
        pill.classList.add('active', 'border-brand-gold', 'text-black', 'bg-brand-gold');
        pill.classList.remove('border-white/10', 'text-brand-white/70', 'bg-white/5');
    } else {
        pill.classList.remove('active', 'border-brand-gold', 'text-black', 'bg-brand-gold');
        pill.classList.add('border-white/10', 'text-brand-white/70', 'bg-white/5');
    }
}

function updateAllPillState() {
    const pillAll = document.getElementById('filter-pill-all');
    const isAnyActive = ratingFilter || under150Filter || vegOnlyFilter || currentCategoryFilter !== 'All';
    setActivePillStyle(pillAll, !isAnyActive);
}

window.startVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Voice search is not supported in this browser.");
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const micIcon = document.querySelector('[data-lucide="mic"]');
    if (micIcon) {
        micIcon.classList.add('text-[#d4a017]', 'animate-pulse');
    }

    recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        if (micIcon) {
            micIcon.classList.remove('text-[#d4a017]', 'animate-pulse');
        }
    };

    recognition.onend = () => {
        if (micIcon) {
            micIcon.classList.remove('text-[#d4a017]', 'animate-pulse');
        }
    };

    recognition.onresult = (event) => {
        const resultText = event.results[0][0].transcript;
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = resultText;
            searchQuery = resultText;
            applyFiltersAndSort();
        }
    };

    recognition.start();
};

// Search Suggestions
function showSearchSuggestions(query) {
    const box = document.getElementById('search-suggestions');
    if (!box) return;

    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }

    // Match against menu item names, categories, descriptions
    const matches = allMenuItems.filter(item => {
        const name = (item.name || '').toLowerCase();
        const cat = (item.category || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        return name.includes(trimmed) || cat.includes(trimmed) || desc.includes(trimmed);
    }).slice(0, 5); // Max 5 suggestions

    if (matches.length === 0) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }

    box.innerHTML = matches.map(item => {
        // Highlight matching portion of the name
        const name = item.name || '';
        const idx = name.toLowerCase().indexOf(trimmed);
        let highlightedName = name;
        if (idx !== -1) {
            highlightedName = name.substring(0, idx) 
                + `<span class="text-brand-gold">${name.substring(idx, idx + trimmed.length)}</span>` 
                + name.substring(idx + trimmed.length);
        }

        const isVeg = item.isVeg === 'true' || item.isVeg === true;
        const vegDot = isVeg
            ? `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-green-600 flex-shrink-0"><span class="w-1 h-1 rounded-full bg-green-600"></span></span>`
            : `<span class="w-3 h-3 flex items-center justify-center bg-white rounded-sm border border-red-600 flex-shrink-0"><span class="w-1 h-1 rounded-full bg-red-600"></span></span>`;

        return `
            <button onclick="window.selectSearchSuggestion('${name.replace(/'/g, "\\'")}')" 
                class="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-b-0">
                <img src="${item.image || 'https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=80'}" 
                    class="w-10 h-10 rounded-xl object-cover border border-white/10 flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                        ${vegDot}
                        <span class="text-sm font-bold text-brand-white truncate">${highlightedName}</span>
                    </div>
                    <span class="text-[10px] text-brand-white/40 font-medium">${item.category || ''}</span>
                </div>
                <span class="text-xs font-black text-brand-gold flex-shrink-0">₹${item.price}</span>
            </button>
        `;
    }).join('');

    box.classList.remove('hidden');
}

window.selectSearchSuggestion = (name) => {
    const searchInput = document.getElementById('search-input');
    const box = document.getElementById('search-suggestions');
    if (searchInput) {
        searchInput.value = name;
        searchQuery = name;
        applyFiltersAndSort();
    }
    if (box) box.classList.add('hidden');

    // Scroll to menu
    const menuSection = document.getElementById('menu-section');
    if (menuSection) menuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Init
async function initApp() {
    const splashStart = Date.now();
    
    // Safety splash screen dismissal backup (maximum 2.2 seconds wait)
    let splashDismissed = false;
    const dismissSplash = () => {
        if (splashDismissed) return;
        splashDismissed = true;
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('splash-exit');
            // Remove from DOM after fade-out animation completes
            setTimeout(() => splash.remove(), 700);
        }
    };
    
    // Safety timeout: 2200ms max loading screen time
    setTimeout(dismissSplash, 2200);

    // Consume Google Redirect Sign-In result on Mobile/iOS Safari load
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            currentUser = result.user;
            updateAuthUI(currentUser);
            // Save user to DB if not exists
            await setDoc(doc(db, "users", currentUser.uid), {
                name: currentUser.displayName,
                email: currentUser.email,
                photo: currentUser.photoURL
            }, { merge: true });
            
        }
    } catch (redirectErr) {
        console.error("Error processing Google Redirect Sign-In:", redirectErr);
        if (typeof showToast === 'function') {
            showToast("Login failed: " + redirectErr.message, "error");
        }
    }
    
    // Load all data behind the splash screen
    try {
        await Promise.all([
            loadStorefront(),
            loadMenu()
        ]);
    } catch(e) {
        console.error("Error during initial load:", e);
    }

    updateCartUI(); // Restore cart count on load
    
    // Listen to Search input with autocomplete suggestions
    const searchInput = document.getElementById('search-input');
    const suggestionsBox = document.getElementById('search-suggestions');
    
    if (searchInput && suggestionsBox) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            applyFiltersAndSort();
            showSearchSuggestions(e.target.value);
        });

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
                suggestionsBox.classList.add('hidden');
            }
        });

        // Close on Escape key
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                suggestionsBox.classList.add('hidden');
                searchInput.blur();
            }
        });

        // Re-show suggestions on focus if there's text
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim().length > 0) {
                showSearchSuggestions(searchInput.value);
            }
        });
    }

    // Listen to Mic button
    const micIcon = document.querySelector('[data-lucide="mic"]');
    if (micIcon) {
        micIcon.addEventListener('click', () => {
            window.startVoiceSearch();
        });
    }
    
    onSnapshot(doc(db, "storeSettings", "info"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentStoreSettings = data;
            
            // App Version Checking Logic (ONLY FOR ANDROID APP)
            if (isAndroidApp && data.latestAppVersion && data.latestAppVersion !== APP_VERSION) {
                const partsCurrent = APP_VERSION.split('.').map(Number);
                const partsLatest = data.latestAppVersion.split('.').map(Number);
                let isOutdated = false;
                for (let i = 0; i < 3; i++) {
                    const c = partsCurrent[i] || 0;
                    const l = partsLatest[i] || 0;
                    if (l > c) { isOutdated = true; break; }
                    if (l < c) { break; }
                }
                if (isOutdated && data.apkDownloadUrl) {
                    const modalVersion = document.getElementById('update-modal-version');
                    const downloadBtn = document.getElementById('update-download-btn');
                    const updateModal = document.getElementById('app-update-modal');
                    
                    if (modalVersion) modalVersion.innerText = data.latestAppVersion;
                    if (downloadBtn) {
                        let finalUrl = data.apkDownloadUrl;
                        try {
                            const urlObj = new URL(finalUrl);
                            // Force Android to open the URL in the standalone Chrome App (breaking out of the TWA)
                            finalUrl = `intent://${urlObj.host}${urlObj.pathname}${urlObj.search}#Intent;scheme=${urlObj.protocol.replace(':', '')};package=com.android.chrome;end;`;
                        } catch(e) {}
                        
                        downloadBtn.href = finalUrl;
                        
                        // Add a fallback click handler in case the href intent is blocked
                        downloadBtn.onclick = (e) => {
                            setTimeout(() => {
                                // If the intent failed to open Chrome after 1 second, fallback to standard window.location
                                window.location.href = data.apkDownloadUrl;
                            }, 1000);
                        };
                    }
                    if (updateModal) updateModal.classList.remove('hidden');
                }
            }

            if (typeof startBannerSliderAutoRotation === 'function') startBannerSliderAutoRotation();
            const mode = data.storeMode || (data.isOnline ? 'open' : 'closed');
            
            const storeStatusBanner = document.getElementById('store-status-banner');
            const storeStatusText = document.getElementById('store-status-text');
            const hangingSign = document.getElementById('hanging-closed-sign');
            const hangingMain = document.getElementById('hanging-sign-main');
            const hangingSub = document.getElementById('hanging-sign-subtext');
            
            if (mode === 'closed' || mode === 'paused') {
                if (hangingSign && hangingMain && hangingSub) {
                    hangingSign.classList.remove('hidden');
                    hangingSign.classList.add('flex');
                    if (mode === 'paused') {
                        hangingMain.innerText = 'PAUSED';
                        hangingSub.innerText = 'Heavy orders. Be back soon!';
                    } else {
                        hangingMain.innerText = 'CLOSED';
                        hangingSub.innerText = 'We will be back soon!';
                    }
                }
                if (storeStatusBanner) {
                    storeStatusBanner.classList.add('hidden');
                    storeStatusBanner.classList.remove('flex');
                }
                document.body.classList.add('store-offline');
            } else if (mode === 'no-delivery') {
                if (hangingSign) {
                    hangingSign.classList.add('hidden');
                    hangingSign.classList.remove('flex');
                }
                if (storeStatusBanner && storeStatusText) {
                    storeStatusBanner.classList.remove('hidden');
                    storeStatusBanner.classList.add('flex');
                    storeStatusBanner.className = "w-full bg-yellow-500/90 text-black text-sm font-bold py-3 px-6 text-center z-[199] relative flex items-center justify-center gap-2";
                    storeStatusText.innerText = "Delivery is currently unavailable. Only Take-in / Pickup orders are being accepted right now.";
                }
                document.body.classList.remove('store-offline');
            } else {
                if (hangingSign) {
                    hangingSign.classList.add('hidden');
                    hangingSign.classList.remove('flex');
                }
                if (storeStatusBanner) {
                    storeStatusBanner.classList.add('hidden');
                    storeStatusBanner.classList.remove('flex');
                }
                document.body.classList.remove('store-offline');
            }
        }
    });

    // Dismiss splash screen after data is loaded (minimum 1.5s for smooth intro)
    const elapsed = Date.now() - splashStart;
    const minSplashTime = 1500;
    const remaining = Math.max(0, minSplashTime - elapsed);
    
    setTimeout(dismissSplash, remaining);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function loadStorefront() {
    try {
        const docSnap = await getDoc(doc(db, "settings", "storefront"));
        let categories = [];
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 1. Update Hero Banner
            if (data.heroBanner) {
                const heroImg = document.getElementById('hero-banner-image');
                const heroTitle = document.getElementById('hero-banner-title');
                const heroSubtitle = document.getElementById('hero-banner-subtitle');
                const heroBtn = document.getElementById('hero-banner-btn');
                
                if (heroImg && data.heroBanner.image) heroImg.src = data.heroBanner.image;
                if (heroTitle && data.heroBanner.title) heroTitle.innerText = data.heroBanner.title;
                if (heroSubtitle && data.heroBanner.subtitle) heroSubtitle.innerHTML = data.heroBanner.subtitle;
                if (heroBtn && data.heroBanner.buttonText) {
                    heroBtn.innerHTML = `${data.heroBanner.buttonText} <i data-lucide="arrow-right" class="w-4 h-4"></i>`;
                }
            }

            if (data.categories && Array.isArray(data.categories)) {
                categories = data.categories;
            }
        }
        
        // Fallback default categories if empty or document does not exist
        if (categories.length === 0) {
            categories = [
                {name: "Biryani", image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=300"},
                {name: "Thali", image: "https://images.unsplash.com/photo-1626776876729-bab4369a5a5a?q=80&w=300"}
            ];
        }

        const container = document.getElementById('categories-container');
        if (container) {
            container.innerHTML = ''; // clear
            categories.forEach(cat => {
                container.innerHTML += `
                    <div class="flex flex-col items-center gap-3 cursor-pointer group flex-shrink-0 snap-start" onclick="window.filterByCategory('${cat.name}')">
                        <div class="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-transparent group-hover:border-brand-gold transition-colors p-1 bg-white/5">
                            <img src="${cat.image || 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=300'}" class="w-full h-full object-cover rounded-full group-hover:scale-110 transition-transform duration-500">
                        </div>
                        <span class="text-brand-white/80 font-bold group-hover:text-brand-gold transition-colors">${cat.name}</span>
                    </div>
                `;
            });
            // Add "Explore All" at the end
            container.innerHTML += `
                <div class="flex flex-col items-center justify-center gap-3 cursor-pointer group flex-shrink-0 snap-start" onclick="window.filterByCategory('All')">
                    <div class="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden border-2 border-white/10 group-hover:border-brand-gold transition-colors flex items-center justify-center bg-white/5">
                        <i data-lucide="arrow-right" class="w-8 h-8 text-white/50 group-hover:text-brand-gold transition-colors"></i>
                    </div>
                    <span class="text-brand-white/80 font-bold group-hover:text-brand-gold transition-colors">Explore All</span>
                </div>
            `;
        }
        if(window.lucide) lucide.createIcons();
    } catch(e) {
        console.error("Error fetching storefront settings", e);
    }
}

// --- Homepage sliding banners logic ---
let homepageBanners = [];
let bannerAutoSlideIntervalId = null;
let currentSlideIndex = 0;

// Listen and fetch active banners dynamically
onSnapshot(collection(db, "banners"), (snap) => {
    homepageBanners = [];
    snap.forEach(docSnap => {
        const b = docSnap.data();
        if (b.isActive !== false) {
            homepageBanners.push({ id: docSnap.id, ...b });
        }
    });
    
    // Sort by creation time
    homepageBanners.sort((a,b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    
    renderHomepageBanners();
});

// Render Dynamic Banners
function renderHomepageBanners() {
    const slidesContainer = document.getElementById('hero-banner-slides');
    const dotsContainer = document.getElementById('hero-slider-dots');
    if (!slidesContainer || !dotsContainer) return;
    
    slidesContainer.innerHTML = '';
    dotsContainer.innerHTML = '';
    
    if (homepageBanners.length === 0) {
        // Fallback banner when no banners are active or configured
        slidesContainer.innerHTML = `
            <div class="slide active absolute inset-0 w-full h-full flex items-center p-8 md:p-12 transition-all duration-700 ease-in-out opacity-100 z-10">
                <div class="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent z-10"></div>
                <img src="https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?q=80&w=1200" class="absolute inset-0 w-full h-full object-cover opacity-30">
                <div class="relative z-20 w-full md:w-2/3">
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ffd700]/20 text-[#ffd700] border border-[#ffd700]/40 rounded-full text-[10px] font-black uppercase tracking-wider mb-4 animate-pulse">
                        ⭐ GOLD MEMBER DEALS ⭐
                    </div>
                    <h2 class="text-3xl md:text-5xl font-black text-[#ffd700] mb-2 leading-none uppercase tracking-tight">GOLD FLASH SALE</h2>
                    <p class="text-brand-white/80 text-sm md:text-base mb-6 font-medium">Get flat <span class="font-bold text-white">₹150 OFF</span> on all orders above ₹499. Use coupon <span class="font-extrabold text-[#ffd700] bg-black/60 px-2 py-0.5 rounded">DIDI150</span></p>
                    <button onclick="window.handleBannerClick('custom', '#menu-section')" class="px-6 py-3 bg-[#ffd700] text-black font-black text-xs rounded-xl shadow-[0_0_20px_rgba(212, 160, 23,0.3)] hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] transition-all flex items-center gap-2 uppercase tracking-wider">
                        Order Now <i data-lucide="arrow-right" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `;
        dotsContainer.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-[#ffd700] cursor-pointer"></span>`;
        if (window.lucide) lucide.createIcons();
        return;
    }
    
    // Inject Slides
    homepageBanners.forEach((b, index) => {
        const isActive = index === 0;
        slidesContainer.innerHTML += `
            <div class="slide ${isActive ? 'active opacity-100 z-10' : 'opacity-0 z-0'} absolute inset-0 w-full h-full flex items-center p-8 md:p-12 transition-all duration-700 ease-in-out" data-slide-index="${index}">
                <div class="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent z-10"></div>
                <img src="${b.image}" class="absolute inset-0 w-full h-full object-cover opacity-30">
                <div class="relative z-20 w-full md:w-2/3">
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ffd700]/20 text-[#ffd700] border border-[#ffd700]/40 rounded-full text-[10px] font-black uppercase tracking-wider mb-4 animate-pulse">
                        ${b.badge || '⭐ PROMOTION ⭐'}
                    </div>
                    <h2 class="text-3xl md:text-5xl font-black text-[#ffd700] mb-2 leading-none uppercase tracking-tight">${b.title}</h2>
                    <p class="text-brand-white/80 text-sm md:text-base mb-6 font-medium">${b.subtitle}</p>
                    <button onclick="window.handleBannerClick('${b.linkType || 'custom'}', '${b.btnLink || ''}')" class="px-6 py-3 bg-[#ffd700] text-black font-black text-xs rounded-xl shadow-[0_0_20px_rgba(212, 160, 23,0.3)] hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.4)] transition-all flex items-center gap-2 uppercase tracking-wider">
                        ${b.btnText || 'Order Now'} <i data-lucide="arrow-right" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `;
        
        // Inject Dots
        dotsContainer.innerHTML += `
            <span onclick="goToSlide(${index})" class="slider-dot w-2.5 h-2.5 rounded-full ${isActive ? 'bg-[#ffd700]' : 'bg-white/20 hover:bg-white/40'} cursor-pointer transition-colors duration-300" data-dot-index="${index}"></span>
        `;
    });
    
    currentSlideIndex = 0;
    startBannerSliderAutoRotation();
    if (window.lucide) lucide.createIcons();
}

// Rotate Banners Logic
window.goToSlide = (index) => {
    const slides = document.querySelectorAll('#hero-banner-slides .slide');
    const dots = document.querySelectorAll('#hero-slider-dots .slider-dot');
    if (slides.length === 0 || index >= slides.length) return;
    
    currentSlideIndex = index;
    
    slides.forEach((slide, sIdx) => {
        if (sIdx === index) {
            slide.classList.add('active', 'opacity-100', 'z-10');
            slide.classList.remove('opacity-0', 'z-0');
        } else {
            slide.classList.remove('active', 'opacity-100', 'z-10');
            slide.classList.add('opacity-0', 'z-0');
        }
    });
    
    dots.forEach((dot, dIdx) => {
        if (dIdx === index) {
            dot.classList.remove('bg-white/20', 'hover:bg-white/40');
            dot.classList.add('bg-[#ffd700]');
        } else {
            dot.classList.add('bg-white/20', 'hover:bg-white/40');
            dot.classList.remove('bg-[#ffd700]');
        }
    });
};

function startBannerSliderAutoRotation() {
    if (bannerAutoSlideIntervalId) {
        clearInterval(bannerAutoSlideIntervalId);
    }
    
    const intervalSecs = currentStoreSettings.bannerInterval || 5;
    
    if (homepageBanners.length <= 1) return; // No rotation needed for 1 slide
    
    bannerAutoSlideIntervalId = setInterval(() => {
        const nextIndex = (currentSlideIndex + 1) % homepageBanners.length;
        goToSlide(nextIndex);
    }, intervalSecs * 1000);
}

window.handleBannerClick = (linkType, btnLink) => {
    if (linkType === 'category') {
        if (typeof window.filterByCategory === 'function') {
            window.filterByCategory(btnLink);
        }
    } else if (linkType === 'dish') {
        // Smooth scroll to menu section
        const menuSection = document.getElementById('menu-section');
        if (menuSection) {
            menuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Open customization modal for this dish
        if (typeof window.openCustomizationModal === 'function') {
            // Give a short timeout for scrolling/rendering if needed
            setTimeout(() => {
                window.openCustomizationModal(btnLink);
            }, 300);
        }
    } else {
        // Custom link or default
        if (btnLink && btnLink.startsWith('#')) {
            const targetEl = document.querySelector(btnLink);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
        }
        window.location.href = btnLink || '#menu-section';
    }
};

// --- Premium Scroll Reveal Engine & Smooth Inertial Scroll ---
let scrollRevealObserver = null;

window.observeNewElements = () => {
    if (!scrollRevealObserver) {
        scrollRevealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('reveal-active');
                    // Stop observing once animated to save resources
                    scrollRevealObserver.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.05,
            rootMargin: "0px 0px -40px 0px"
        });
    }

    // Capture all customizable reveal animation elements
    const selectors = [
        '.reveal-element', '.reveal-lift', '.reveal-fade-in', 
        '.reveal-slide-left', '.reveal-slide-right', '.reveal-scale',
        '.menu-card-premium', '#categories-container > div', 
        '#recommended-deals-section', '#menu-section-title', 
        '#categories-container', '.slide', '#hero-banner-slider-container'
    ];
    
    const items = document.querySelectorAll(selectors.join(', '));
    items.forEach((el) => {
        // Set default visual animation classes if none are defined
        if (!el.classList.contains('reveal-element') && 
            !el.classList.contains('reveal-lift') && 
            !el.classList.contains('reveal-fade-in') && 
            !el.classList.contains('reveal-slide-left') && 
            !el.classList.contains('reveal-slide-right') && 
            !el.classList.contains('reveal-scale')) {
            el.classList.add('reveal-lift');
        }
        
        // Auto staggered entrance delays for grid children & category bubbles
        if (el.parentNode) {
            if (el.closest('#menu-grid') || el.closest('#categories-container') || el.closest('#recommended-carousel')) {
                const indexInParent = Array.from(el.parentNode.children).indexOf(el);
                const delay = (indexInParent % 4) * 85; // Stagger up to 4 columns beautifully
                el.style.transitionDelay = `${delay}ms`;
            }
        }

        scrollRevealObserver.observe(el);
    });
};

// Premium Lenis Smooth Scroll Initialization
function initLenis() {
    if (typeof Lenis === 'undefined') {
        console.warn("Lenis smooth scroll engine is not loaded via CDN. Falling back to native scrolling.");
        return;
    }
    
    const lenis = new Lenis({
        duration: 1.3,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Butter-smooth exponential deceleration
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

    // Dynamic elegant smooth-scrolling for all anchor tag links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#') return;
            e.preventDefault();
            const targetEl = document.querySelector(href);
            if (targetEl) {
                lenis.scrollTo(targetEl, { 
                    offset: -60,
                    duration: 1.4
                });
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Populate App Version in UI (ONLY FOR ANDROID APP)
    if (isAndroidApp) {
        document.querySelectorAll('.app-version-text').forEach(el => el.innerText = APP_VERSION);
    } else {
        // Hide the version display entirely for web users
        document.querySelectorAll('.app-version-display').forEach(el => el.classList.add('hidden'));
    }

    // Initialize Lenis Smooth momentum scrolling
    initLenis();
    
    // Start initial scroll reveal observation
    setTimeout(() => {
        window.observeNewElements();
    }, 800);

    // Auto-login trigger if redirected from checkout
    if (localStorage.getItem('didiTriggerLogin') === 'true') {
        localStorage.removeItem('didiTriggerLogin');
        localStorage.setItem('didiRedirectPending', 'true');
        setTimeout(() => {
            if (typeof window.showToast === 'function') {
                window.showToast("Please login to proceed to checkout.", "info");
            }
            window.handleLogin();
        }, 1000);
    }
});

// Complete Profile Modal functions
function openCompleteProfileModal() {
    const modal = document.getElementById('complete-profile-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Try pre-filling fields from currentUser/localStorage
        const nameInput = document.getElementById('profile-name');
        if (nameInput && currentUser) {
            nameInput.value = currentUser.displayName || '';
        }
        
        const phoneInput = document.getElementById('profile-phone');
        if (phoneInput) {
            phoneInput.value = localStorage.getItem('didisLastPhone') || '';
        }
        if (window.lucide) window.lucide.createIcons();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('complete-profile-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('profile-name').value.trim();
        const phone = document.getElementById('profile-phone').value.trim();
        const addr = document.getElementById('profile-address').value.trim();
        const city = document.getElementById('profile-city').value.trim();
        const zip = document.getElementById('profile-zip').value.trim();
        
        if (!name || !phone || !addr || !city || !zip) {
            if (typeof window.showToast === 'function') {
                window.showToast("All fields are required.", "error");
            } else {
                alert("All fields are required.");
            }
            return;
        }
        if (!/^[0-9]{10}$/.test(phone)) {
            if (typeof window.showToast === 'function') window.showToast("Phone number must be exactly 10 digits.", "error");
            else alert("Phone number must be exactly 10 digits.");
            return;
        }
        if (!/^[0-9]{6}$/.test(zip)) {
            if (typeof window.showToast === 'function') window.showToast("Zip code must be exactly 6 digits.", "error");
            else alert("Zip code must be exactly 6 digits.");
            return;
        }

        const combinedAddress = `${addr}, ${city}, Assam - ${zip}`;
        
        try {
            if (currentUser) {
                await setDoc(doc(db, "users", currentUser.uid), {
                    name: name,
                    phone: phone,
                    address: combinedAddress,
                    addressLine: addr,
                    city: city,
                    zip: zip,
                    customerSince: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                }, { merge: true });
                
                localStorage.setItem('didisLastPhone', phone);
                localStorage.setItem('didisLastAddress', combinedAddress);
                
                const modal = document.getElementById('complete-profile-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                }
                
                // Redirect back to checkout if flagged
                if (localStorage.getItem('didiRedirectToCheckoutAfterProfileComplete') === 'true') {
                    localStorage.removeItem('didiRedirectToCheckoutAfterProfileComplete');
                    window.location.href = 'checkout.html';
                }
                
                if (typeof window.showToast === 'function') {
                    window.showToast("Profile completed successfully! Welcome to Didi's Biryani.", "success");
                } else {
                    alert("Profile completed successfully! Welcome to Didi's Biryani.");
                }
            }
        } catch(err) {
            console.error("Error saving profile details:", err);
            if (typeof window.showToast === 'function') {
                window.showToast("Failed to save profile: " + err.message, "error");
            } else {
                alert("Failed to save profile: " + err.message);
            }
        }
    });

    document.getElementById('profile-logout-btn')?.addEventListener('click', async () => {
        await signOut(auth);
        window.location.reload();
    });
});

// Checkout button redirect flow
window.handleCheckoutButtonClick = async () => {
    if (!currentUser) {
        if (typeof window.showToast === 'function') {
            window.showToast("Please login with Google first to checkout!", "info");
        }
        try {
            // Set flag so if it redirects on mobile, we return here
            localStorage.setItem('didiRedirectPending', 'true');
            await window.handleLogin();
            if (currentUser) {
                // Check completeness
                const userSnap = await getDoc(doc(db, "users", currentUser.uid));
                let hasPhone = false;
                let hasAddress = false;
                let phoneVal = '';
                let addressVal = '';

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    if (userData.phone) { hasPhone = true; phoneVal = userData.phone; }
                    if (userData.address) { hasAddress = true; addressVal = userData.address; }
                }

                const localPhone = localStorage.getItem('didisLastPhone');
                const localAddress = localStorage.getItem('didisLastAddress');

                if (localPhone) { hasPhone = true; phoneVal = localPhone; }
                if (localAddress) { hasAddress = true; addressVal = localAddress; }

                if (hasPhone && hasAddress) {
                    localStorage.removeItem('didiRedirectPending');
                    await setDoc(doc(db, "users", currentUser.uid), {
                        phone: phoneVal,
                        address: addressVal
                    }, { merge: true });
                    window.location.href = 'checkout.html';
                } else {
                    localStorage.setItem('didiRedirectToCheckoutAfterProfileComplete', 'true');
                    openCompleteProfileModal();
                }
            }
        } catch (e) {
            console.error("Checkout login redirect failed", e);
        }
    } else {
        // Already logged in. Check if profile is complete.
        try {
            const userSnap = await getDoc(doc(db, "users", currentUser.uid));
            let hasPhone = false;
            let hasAddress = false;
            let phoneVal = '';
            let addressVal = '';

            if (userSnap.exists()) {
                const userData = userSnap.data();
                if (userData.phone) { hasPhone = true; phoneVal = userData.phone; }
                if (userData.address) { hasAddress = true; addressVal = userData.address; }
            }

            const localPhone = localStorage.getItem('didisLastPhone');
            const localAddress = localStorage.getItem('didisLastAddress');

            if (localPhone) { hasPhone = true; phoneVal = localPhone; }
            if (localAddress) { hasAddress = true; addressVal = localAddress; }

            if (hasPhone && hasAddress) {
                // Ensure synced to Firestore and go to checkout
                await setDoc(doc(db, "users", currentUser.uid), {
                    phone: phoneVal,
                    address: addressVal
                }, { merge: true });
                window.location.href = 'checkout.html';
            } else {
                openCompleteProfileModal();
            }
        } catch (e) {
            console.error("Error evaluating profile completeness:", e);
            openCompleteProfileModal();
        }
    }
};

