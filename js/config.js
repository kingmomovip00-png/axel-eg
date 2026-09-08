export const ADMIN_EMAIL = "axel.support.eg@gmail.com";
// Final backend is designed to serve the website itself, so relative /api works after deployment.
// For a separate frontend host, set window.AXEL_BACKEND_URL before these modules load.
export const BACKEND_URL = (typeof window !== "undefined" && window.AXEL_BACKEND_URL)
  ? window.AXEL_BACKEND_URL.replace(/\/$/, "")
  : "";
export const API_URL = `${BACKEND_URL}/api`;
export const SHIPPING_PRICE = 50;
export const WHATSAPP_URL = "https://wa.me/201153040626";
