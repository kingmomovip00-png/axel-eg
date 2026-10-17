export const ADMIN_EMAIL = "axel.support.eg@gmail.com";
// Final backend is designed to serve the website itself, so relative /api works after deployment.
// For a separate frontend host, set window.AXEL_BACKEND_URL before these modules load.
export const BACKEND_URL = (typeof window !== "undefined" && window.AXEL_BACKEND_URL)
  ? window.AXEL_BACKEND_URL.replace(/\/$/, "")
  : "";
export const API_URL = `${BACKEND_URL}/api`;
export const SHIPPING_PRICE = 50;
export const WHATSAPP_URL = "https://wa.me/201153040626";

// Links shown on the QR landing page (qr.html). Edit these to change the steps.
export const SITE_URL = "https://axel-eg.com";
export const QR_LINKS = [
  { id: "instagram", name: "انستجرام", handle: "@axel.egypt", url: "https://www.instagram.com/axel.egypt", icon: "assets/icons/instagram.svg" },
  { id: "tiktok", name: "تيك توك", handle: "@axel_egypt", url: "https://www.tiktok.com/@axel_egypt", icon: "assets/icons/tiktok.svg" },
  { id: "facebook", name: "فيسبوك", handle: "AXEL", url: "https://www.facebook.com/share/1CKzTxHWMK/", icon: "assets/icons/facebook.svg" }
];
