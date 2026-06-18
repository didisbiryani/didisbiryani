import { db, doc, getDoc, updateDoc, onSnapshot } from './firebase-config.js';

let currentOrder = null;
let currentStoreSettings = null;

// Simple Toast implementation for this page
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const isSuccess = type === 'success';
    
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-md transform transition-all duration-300 translate-y-[-20px] opacity-0 ${
        isSuccess 
            ? 'bg-green-500/10 border-green-500/30 text-green-500' 
            : 'bg-red-500/10 border-red-500/30 text-red-500'
    }`;
    
    toast.innerHTML = `
        <i data-lucide="${isSuccess ? 'check-circle' : 'alert-circle'}" class="w-5 h-5 shrink-0"></i>
        <p class="text-sm font-bold">${message}</p>
    `;
    
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-[-20px]', 'opacity-0');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-[-20px]');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function initPaymentPage() {
    const urlParams = new URLSearchParams(window.location.search);
    let orderId = urlParams.get('orderId');

    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const paymentCard = document.getElementById('payment-card');
    const successState = document.getElementById('success-state');

    if (orderId) {
        orderId = orderId.trim();
        // Remove trailing slash if present (common when opened from links or WhatsApp on iOS)
        if (orderId.endsWith('/')) {
            orderId = orderId.slice(0, -1);
        }
    }

    if (!orderId) {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        document.getElementById('error-message').innerText = "No Order ID provided in the link.";
        return;
    }

    try {
        // Fetch Store Settings
        const storeDoc = await getDoc(doc(db, "storeSettings", "info"));
        if (storeDoc.exists()) {
            currentStoreSettings = storeDoc.data();
        }

        // Fetch Order Details
        const orderDoc = await getDoc(doc(db, "orders", orderId));
        if (!orderDoc.exists()) {
            throw new Error("Order not found.");
        }

        currentOrder = { id: orderDoc.id, ...orderDoc.data() };

        // Check if already paid
        if (currentOrder.paymentMethod === 'Online (Razorpay)' || currentOrder.paymentMethod === 'Direct UPI') {
            loadingState.classList.add('hidden');
            successState.classList.remove('hidden');
            successState.classList.add('flex');
            return;
        }

        // Render Order Details
        const amountDue = currentOrder.amountDue !== undefined ? currentOrder.amountDue : currentOrder.total;
        document.getElementById('pay-amount').innerText = `₹${amountDue}`;
        document.getElementById('pay-order-id').innerText = `#${currentOrder.orderNumber ? String(currentOrder.orderNumber).padStart(5, '0') : currentOrder.id.slice(0, 6).toUpperCase()}`;
        document.getElementById('pay-customer').innerText = currentOrder.customer;

        renderPaymentMethods();

        loadingState.classList.add('hidden');
        paymentCard.classList.remove('hidden');

    } catch (e) {
        console.error("Error loading payment page:", e);
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        errorState.classList.add('flex');
    }
}

function renderPaymentMethods() {
    const container = document.getElementById('payment-methods-container');
    container.innerHTML = `
        <button id="rzp-btn" class="w-full py-4 bg-[#3395FF] text-white font-black text-lg rounded-xl shadow-[0_0_15px_rgba(51,149,255,0.4)] hover:bg-white hover:text-[#3395FF] transition-colors flex items-center justify-center gap-2 mb-3">
            Pay Securely via Razorpay
        </button>
    `;
    
    document.getElementById('rzp-btn').addEventListener('click', () => {
        payViaRazorpay(false);
    });
    
    if (window.lucide) lucide.createIcons();
}

function payViaRazorpay(forceQR = false) {
    if (typeof Razorpay === 'undefined') {
        showToast('Razorpay SDK failed to load. Please check your connection.', 'error');
        return;
    }

    const amountDue = currentOrder.amountDue !== undefined ? currentOrder.amountDue : currentOrder.total;
    const amountInPaise = Math.round(Number(amountDue) * 100);

    const options = {
        key: 'rzp_live_Suhxp1cUZNzELt',
        payment_capture: 1,
        amount: amountInPaise,
        currency: "INR",
        name: "Didi's Biryani",
        description: `Order #${currentOrder.orderNumber ? String(currentOrder.orderNumber).padStart(5, '0') : currentOrder.id.slice(0, 6).toUpperCase()}`,
        image: "https://didisbiryani.in/didis_logo.webp",
        handler: async function (response) {
            try {
                showToast("Payment processing...", "success");
                
                // Delegate ALL database updates to the server-side API
                // (client-side updateDoc fails because Firestore rules
                //  only allow admin/driver to update orders)
                const verifyRes = await fetch('/api/verify-payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        paymentId: response.razorpay_payment_id,
                        amount: amountInPaise,
                        orderId: currentOrder.id
                    })
                });

                const verifyData = await verifyRes.json();
                
                if (verifyData.success) {
                    document.getElementById('payment-card').classList.add('hidden');
                    document.getElementById('success-state').classList.remove('hidden');
                    document.getElementById('success-state').classList.add('flex');
                    showToast("Payment successful!", "success");
                } else {
                    // Fallback: try client-side update (might work if user is the order owner)
                    try {
                        const updatePayload = {
                            paymentMethod: 'Online (Razorpay)',
                            paymentStatus: 'Paid',
                            amountDue: 0
                        };
                        if (currentOrder.isManual && currentOrder.status === 'Pending') {
                            updatePayload.status = 'Accepted';
                        }
                        await updateDoc(doc(db, "orders", currentOrder.id), updatePayload);
                    } catch (fbErr) {
                        console.error("Client-side fallback also failed:", fbErr);
                    }
                    
                    document.getElementById('payment-card').classList.add('hidden');
                    document.getElementById('success-state').classList.remove('hidden');
                    document.getElementById('success-state').classList.add('flex');
                    showToast("Payment received!", "success");
                }

            } catch (err) {
                console.error("Error updating order:", err);
                showToast("Payment went through but status update failed. Please contact the restaurant.", 'error');
            }
        },
        prefill: {
            name: currentOrder.customer || "",
            contact: currentOrder.phone || "",
            email: currentOrder.email || "customer@didisbiryani.in"
        },
        theme: {
            color: "#D4A017"
        }
    };

    if (forceQR) {
        options.config = {
            display: {
                blocks: {
                    upi: {
                        name: "Pay via UPI QR",
                        instruments: [{ method: "upi", flows: ["qr"] }]
                    }
                },
                sequence: ["block.upi"],
                preferences: { show_default_blocks: true }
            }
        };
    }

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response){
        showToast("Payment failed: " + response.error.description, "error");
    });
    rzp.open();
}

// Initialize
document.addEventListener('DOMContentLoaded', initPaymentPage);
