importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyBzePsRjC7pvnLQNxqUhHI5tuTndc9ggek",
    authDomain: "didisbiryani-876ca.firebaseapp.com",
    projectId: "didisbiryani-876ca",
    storageBucket: "didisbiryani-876ca.firebasestorage.app",
    messagingSenderId: "455024925550",
    appId: "1:455024925550:web:1fc4006674d7e6147cbf7f",
    measurementId: "G-HR95B9XHDK"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/images/icon.png', // Assuming there's a logo icon
        badge: '/images/icon.png',
        data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
