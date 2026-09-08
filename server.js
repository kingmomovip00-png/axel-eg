import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import ImageKit from "imagekit";
import helmet from "helmet";
import morgan from "morgan";
import crypto from "crypto";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "axel.support.eg@gmail.com").toLowerCase();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 12 }
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan("tiny"));
app.use(cors({
  origin(origin, cb) {
    const allowed = (process.env.FRONTEND_ORIGIN || "*").split(",").map(x => x.trim()).filter(Boolean);
    if (!origin || allowed.includes("*") || allowed.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

function isImageKitConfigured() {
  return Boolean(process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT);
}

let db = null;
function initFirebaseAdmin() {
  if (admin.apps.length) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!raw) return false;
  try {
    const serviceAccount = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    return true;
  } catch (error) {
    console.error("Firebase Admin init error:", error.message);
    return false;
  }
}
const firebaseReady = initFirebaseAdmin();

function requireFirebase(res) {
  if (!firebaseReady || !db) {
    res.status(503).json({ ok: false, error: "Firebase Admin غير مُعد. أضف FIREBASE_SERVICE_ACCOUNT_BASE64 إلى متغيرات البيئة." });
    return false;
  }
  return true;
}

async function requireAdmin(req, res, next) {
  if (!requireFirebase(res)) return;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, error: "تسجيل الدخول مطلوب" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if ((decoded.email || "").toLowerCase() !== ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: "غير مسموح" });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: "جلسة الدخول غير صالحة" });
  }
}

function cleanFolder(folder = "/axel") {
  const safe = String(folder).replace(/[^a-zA-Z0-9/_-]/g, "").replace(/\/+/g, "/");
  return safe.startsWith("/") ? safe : `/${safe}`;
}

function makeOrderCode() {
  return `AX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function notifyTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const text = [
    "🛍️ طلب جديد - AXEL",
    `رقم الطلب: ${order.orderCode}`,
    `العميل: ${order.customerName}`,
    `الهاتف: ${order.phone}`,
    `المنتج: ${order.productName}`,
    `اللون: ${order.color}`,
    `المقاس: ${order.size}`,
    `الكمية: ${order.quantity}`,
    `الإجمالي: ${order.total} جنيه`,
    `طريقة الدفع: ${order.paymentMethod}`,
    `حالة الدفع: ${order.paymentStatus}`,
    `العنوان: ${order.address}`
  ].join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (error) {
    console.error("Telegram notification failed:", error.message);
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "AXEL backend",
    imagekit: isImageKitConfigured(),
    firebaseAdmin: firebaseReady
  });
});

app.get("/api/config", (req, res) => {
  res.json({ ok: true, imagekitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || null });
});

app.get("/api/imagekit-auth", requireAdmin, (req, res) => {
  if (!isImageKitConfigured()) return res.status(503).json({ ok: false, error: "ImageKit غير مُعد" });
  try {
    res.json({ ok: true, ...imagekit.getAuthenticationParameters() });
  } catch (error) {
    res.status(500).json({ ok: false, error: "فشل إنشاء ImageKit auth" });
  }
});

app.post("/api/upload", requireAdmin, upload.array("files", 12), async (req, res) => {
  if (!isImageKitConfigured()) return res.status(503).json({ ok: false, error: "ImageKit غير مُعد" });
  const files = req.files?.length ? req.files : (req.file ? [req.file] : []);
  if (!files.length) return res.status(400).json({ ok: false, error: "لم يتم اختيار أي ملف" });
  try {
    const folder = cleanFolder(req.body.folder || "/axel");
    const results = [];
    for (const file of files) {
      if (!file.mimetype?.startsWith("image/")) {
        return res.status(400).json({ ok: false, error: "مسموح برفع الصور فقط" });
      }
      const result = await imagekit.upload({
        file: file.buffer.toString("base64"),
        fileName: file.originalname,
        folder,
        useUniqueFileName: true,
        tags: ["axel"]
      });
      results.push({ url: result.url, fileId: result.fileId, name: result.name, thumbnailUrl: result.thumbnailUrl || result.url });
    }
    res.json({ ok: true, files: results });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ ok: false, error: "فشل رفع الصورة", details: process.env.NODE_ENV === "development" ? error.message : undefined });
  }
});

app.delete("/api/upload/:fileId", requireAdmin, async (req, res) => {
  if (!isImageKitConfigured()) return res.status(503).json({ ok: false, error: "ImageKit غير مُعد" });
  try {
    await imagekit.deleteFile(req.params.fileId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "فشل حذف الصورة" });
  }
});

// Public order creation. Stock is decremented atomically on the server.
app.post("/api/orders", async (req, res) => {
  if (!requireFirebase(res)) return;
  const { productId, color, size, quantity = 1, customerName, phone, address, paymentMethod = "غير محدد" } = req.body || {};
  const qty = Math.max(1, Math.min(10, Number(quantity) || 1));
  if (!productId || !color || !size || !customerName || !phone || !address) {
    return res.status(400).json({ ok: false, error: "بيانات الطلب غير مكتملة" });
  }
  try {
    const productRef = db.collection("products").doc(productId);
    const orderCode = makeOrderCode();
    let orderData;
    const orderRef = await db.runTransaction(async (tx) => {
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists) throw new Error("PRODUCT_NOT_FOUND");
      const product = productSnap.data();
      if (product.active === false) throw new Error("PRODUCT_INACTIVE");
      const available = Number(product.stock?.[color]?.[size] || 0);
      if (available < qty) throw new Error("OUT_OF_STOCK");
      const nextStock = structuredClone(product.stock || {});
      nextStock[color] = nextStock[color] || {};
      nextStock[color][size] = available - qty;
      tx.update(productRef, { stock: nextStock, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      const shipping = Number(process.env.SHIPPING_PRICE || 50);
      const subtotal = Number(product.salePrice || 0) * qty;
      orderData = {
        orderCode,
        productId,
        productName: product.name || "منتج AXEL",
        imageUrl: product.images?.find(x => x.color === color)?.url || product.images?.[0]?.url || "",
        color,
        size,
        quantity: qty,
        customerName: String(customerName).trim(),
        phone: String(phone).trim(),
        address: String(address).trim(),
        paymentMethod,
        paymentStatus: "pending",
        status: "جديد",
        subtotal,
        shipping,
        total: subtotal + shipping,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = db.collection("orders").doc();
      tx.set(ref, orderData);
      return ref;
    });
    await notifyTelegram({ ...orderData, id: orderRef.id });
    res.status(201).json({ ok: true, orderId: orderRef.id, orderCode, total: orderData.total, paymentStatus: orderData.paymentStatus });
  } catch (error) {
    const map = {
      PRODUCT_NOT_FOUND: "المنتج غير موجود",
      PRODUCT_INACTIVE: "هذا المنتج غير متاح حالياً",
      OUT_OF_STOCK: "الكمية المطلوبة غير متاحة"
    };
    const message = map[error.message] || "فشل إنشاء الطلب";
    console.error("Create order error:", error.message);
    res.status(400).json({ ok: false, error: message });
  }
});

// Customer tracks an order with order code + the last digits of their phone.
app.get("/api/orders/track", async (req, res) => {
  if (!requireFirebase(res)) return;
  const orderCode = String(req.query.code || "").trim();
  const phone = String(req.query.phone || "").trim();
  if (!orderCode || !phone) return res.status(400).json({ ok: false, error: "اكتب رقم الطلب ورقم الهاتف" });
  try {
    const snap = await db.collection("orders").where("orderCode", "==", orderCode).limit(1).get();
    if (snap.empty) return res.status(404).json({ ok: false, error: "لم يتم العثور على الطلب" });
    const data = snap.docs[0].data();
    if (!String(data.phone || "").replace(/\D/g, "").endsWith(phone.replace(/\D/g, ""))) {
      return res.status(403).json({ ok: false, error: "رقم الهاتف غير مطابق" });
    }
    res.json({ ok: true, order: {
      orderCode: data.orderCode,
      productName: data.productName,
      color: data.color,
      size: data.size,
      quantity: data.quantity,
      total: data.total,
      status: data.status,
      paymentMethod: data.paymentMethod,
      paymentStatus: data.paymentStatus,
      createdAt: data.createdAt?.toDate?.().toISOString?.() || null
    }});
  } catch (error) {
    res.status(500).json({ ok: false, error: "تعذر تتبع الطلب الآن" });
  }
});

app.post("/api/visits", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const key = new Date().toISOString().slice(0, 10);
    await db.collection("analytics").doc(key).set({
      visits: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [products, orders, analytics] = await Promise.all([
      db.collection("products").get(),
      db.collection("orders").get(),
      db.collection("analytics").get()
    ]);
    let sales = 0;
    let paid = 0;
    const recentOrders = [];
    orders.forEach(doc => {
      const o = { id: doc.id, ...doc.data() };
      sales += Number(o.total || 0);
      if (o.paymentStatus === "paid") paid += Number(o.total || 0);
      recentOrders.push({ id: doc.id, orderCode: o.orderCode, customerName: o.customerName, total: o.total, status: o.status, paymentStatus: o.paymentStatus });
    });
    let visits = 0;
    analytics.forEach(doc => visits += Number(doc.data().visits || 0));
    recentOrders.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    res.json({ ok: true, stats: { products: products.size, orders: orders.size, sales, paidSales: paid, visits }, recentOrders: recentOrders.slice(0, 20) });
  } catch (error) {
    res.status(500).json({ ok: false, error: "فشل تحميل الإحصائيات" });
  }
});

// Payment webhooks must be configured with the provider-specific signature verification.
// This endpoint intentionally refuses unsigned updates.
app.post("/api/payments/webhook", (req, res) => {
  res.status(501).json({ ok: false, error: "اربط بيانات بوابة الدفع أولاً ثم فعّل التحقق الخاص بالبوابة قبل استقبال Webhook." });
});

// Serve the website and make the whole project deployable as one service.
app.use(express.static(__dirname, { index: "index.html", extensions: ["html"] }));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "API endpoint غير موجود" });
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AXEL final backend running on port ${PORT}`);
  console.log(`ImageKit: ${isImageKitConfigured() ? "configured" : "missing config"}`);
  console.log(`Firebase Admin: ${firebaseReady ? "configured" : "missing config"}`);
});
