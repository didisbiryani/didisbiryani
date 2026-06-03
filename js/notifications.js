import { db, auth, collection, query, where, onSnapshot, onAuthStateChanged, messaging, getToken, doc, updateDoc } from './firebase-config.js';

let isInitialOrderLoad = true;
let isInitialMessageLoad = true;
let ordersUnsubscribe = null;
let messagesUnsubscribe = null;

// Helper to show a notification toast
function showNotification(message, type = "info") {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        console.log("Notification:", message);
    }
}

async function requestPushPermission(user) {
    try {
        if (!('serviceWorker' in navigator)) {
            console.log('Service workers are not supported.');
            return;
        }

        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            const currentToken = await getToken(messaging, { 
                vapidKey: 'BPJb6R_MDcrfJpmdPUUa4_I_BT3BvCXBbh3b3YrqB30e6cJCiQCnI8iFAicM4smfp36WeBS9dwMv2KZuu86fWlE',
                serviceWorkerRegistration: registration
            });
            
            if (currentToken) {
                // Save token to user profile
                await updateDoc(doc(db, "users", user.uid), {
                    fcmToken: currentToken
                });
                console.log("FCM Token saved successfully.");
            }
        }
    } catch (error) {
        console.log('An error occurred while retrieving token. ', error);
    }
}

// Start listening for notifications when user logs in
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Request Push Permissions
        requestPushPermission(user);
        // 1. Listen for Order Status Changes
        const ordersQuery = query(collection(db, "orders"), where("userId", "==", user.uid));
        ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
            if (isInitialOrderLoad) {
                isInitialOrderLoad = false;
                return; // Don't trigger popups on the very first page load
            }

            snapshot.docChanges().forEach((change) => {
                if (change.type === "modified") {
                    const order = change.doc.data();
                    const status = order.status || 'Pending';
                    const orderNo = order.orderNumber || order.id;
                    
                    showNotification(`Order #${orderNo} status updated to: ${status}`, "success");
                }
            });
        });

        // 2. Listen for New Admin Chat Messages
        const messagesQuery = query(collection(db, "messages"), where("userId", "==", user.uid));
        messagesUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
            if (isInitialMessageLoad) {
                isInitialMessageLoad = false;
                return;
            }

            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const msg = change.doc.data();
                    // If the message is from the admin, show a popup
                    if (msg.sender === "admin") {
                        showNotification(`New message from Didi's Biryani Support`, "info");
                    }
                }
            });
        });

    } else {
        // Clean up listeners if user logs out
        if (ordersUnsubscribe) ordersUnsubscribe();
        if (messagesUnsubscribe) messagesUnsubscribe();
        isInitialOrderLoad = true;
        isInitialMessageLoad = true;
    }
});
