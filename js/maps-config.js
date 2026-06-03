/**
 * maps-config.js — Shared Google Maps configuration for Didi's Biryani
 * Dark-themed map styles, distance utilities, and store coordinates.
 */

// ── Store Location ──────────────────────────────────────────────
export const STORE_LOCATION = {
    lat: 24.8245,
    lng: 92.7988,
    address: "Udharbond, Main Market Road, Near Post Office, Silchar, Assam 788030"
};

// ── Dark Map Style (matches app aesthetic) ──────────────────────
export const DARK_MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0a0a0a" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d4a017" }]
    },
    {
        featureType: "poi",
        elementType: "labels.text.fill",
        stylers: [{ color: "#93817c" }]
    },
    {
        featureType: "poi.park",
        elementType: "geometry.fill",
        stylers: [{ color: "#1b3320" }]
    },
    {
        featureType: "poi.park",
        elementType: "labels.text.fill",
        stylers: [{ color: "#447530" }]
    },
    {
        featureType: "road",
        elementType: "geometry",
        stylers: [{ color: "#2c2c3e" }]
    },
    {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{ color: "#1a1a2e" }]
    },
    {
        featureType: "road",
        elementType: "labels.text.fill",
        stylers: [{ color: "#9ca5b3" }]
    },
    {
        featureType: "road.highway",
        elementType: "geometry",
        stylers: [{ color: "#3a3a50" }]
    },
    {
        featureType: "road.highway",
        elementType: "geometry.stroke",
        stylers: [{ color: "#1f1f30" }]
    },
    {
        featureType: "road.highway",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d4a017" }]
    },
    {
        featureType: "transit",
        elementType: "geometry",
        stylers: [{ color: "#2c2c3e" }]
    },
    {
        featureType: "transit.station",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d4a017" }]
    },
    {
        featureType: "water",
        elementType: "geometry",
        stylers: [{ color: "#0e1626" }]
    },
    {
        featureType: "water",
        elementType: "labels.text.fill",
        stylers: [{ color: "#4e6d70" }]
    }
];

// ── Custom Map Marker SVG Paths ─────────────────────────────────
export const MARKER_ICONS = {
    customer: {
        path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z",
        fillColor: "#D4A017",
        fillOpacity: 1,
        strokeColor: "#000",
        strokeWeight: 1.5,
        scale: 1.8,
        anchor: null // set at runtime: new google.maps.Point(12, 24)
    },
    store: {
        path: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z",
        fillColor: "#22C55E",
        fillOpacity: 1,
        strokeColor: "#000",
        strokeWeight: 1.5,
        scale: 1.6,
        anchor: null
    },
    deliveryBoy: {
        path: "M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65L13.52 14H10V9H6c-2.21 0-4 1.79-4 4v3h2c0 1.66 1.34 3 3 3s3-1.34 3-3h4.48L19 10.35V7zM7 17c-.55 0-1-.45-1-1h2c0 .55-.45 1-1 1zm10 0c-.55 0-1-.45-1-1h2c0 .55-.45 1-1 1zm0-8h-2V7h2v2zm0 5c-1.66 0-3 1.34-3 3h2c0-.55.45-1 1-1s1 .45 1 1h2c0-1.66-1.34-3-3-3z",
        fillColor: "#3B82F6",
        fillOpacity: 1,
        strokeColor: "#000",
        strokeWeight: 1,
        scale: 1.6,
        anchor: null
    }
};

// ── Haversine Distance (km) ─────────────────────────────────────
export function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = _toRad(lat2 - lat1);
    const dLng = _toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function _toRad(deg) {
    return deg * (Math.PI / 180);
}

// ── ETA Estimation ──────────────────────────────────────────────
// Average delivery speed: ~15 km/h for city traffic (bikes/scooters)
export function estimateETA(distanceKm) {
    const avgSpeedKmH = 15;
    const minutes = Math.round((distanceKm / avgSpeedKmH) * 60);
    return Math.max(1, minutes); // at least 1 minute
}

// ── Format distance for display ─────────────────────────────────
export function formatDistance(km) {
    if (km < 1) {
        return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
}

// ── Create Dark-Themed Google Map ───────────────────────────────
export function createStyledMap(element, center, zoom = 15) {
    if (!window.google || !window.google.maps) {
        console.error("Google Maps API not loaded");
        return null;
    }

    return new google.maps.Map(element, {
        center,
        zoom,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: {
            position: google.maps.ControlPosition.RIGHT_CENTER
        },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy"
    });
}

// ── Create Custom Marker ────────────────────────────────────────
export function createCustomMarker(map, position, type = 'customer', title = '') {
    const iconConfig = { ...MARKER_ICONS[type] };
    iconConfig.anchor = new google.maps.Point(12, 24);

    return new google.maps.Marker({
        position,
        map,
        title,
        icon: iconConfig
    });
}
