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
  limits: { fileSize: 15 * 1024 * 1024, files: 20 }
});

app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(morgan("tiny"));
app.use(cors({
  origin(origin, cb) {
    const allowed = (process.env.FRONTEND_ORIGIN || "*").split(",").map(x => x.trim()).filter(Boolean);
    if (!origin || allowed.includes("*") || allowed.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked"));
  }
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

const isImageKitConfigured = () => Boolean(
  process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT
);

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
  } catch {
    return res.status(401).json({ ok: false, error: "جلسة الدخول غير صالحة" });
  }
}

const cleanFolder = (folder = "/axel") => {
  const safe = String(folder).replace(/[^a-zA-Z0-9/_-]/g, "").replace(/\/+/g, "/");
  return safe.startsWith("/") ? safe : `/${safe}`;
};
const makeOrderCode = () => `AX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const asArray = value => Array.isArray(value) ? value : [];
const stamp = value => value?.toDate?.().toISOString?.() || value || null;
const serializeDoc = doc => ({ id: doc.id, ...doc.data() });

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
  res.json({ ok: true, service: "AXEL backend", imagekit: isImageKitConfigured(), firebaseAdmin: firebaseReady });
});
app.get("/api/config", (req, res) => res.json({ ok: true, imagekitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || null }));

// ---------- PUBLIC CATALOG ----------
app.get("/api/products", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const onlyActive = req.query.active !== "false";
    let ref = db.collection("products");
    if (onlyActive) ref = ref.where("active", "==", true);
    const snap = await ref.get();
    const products = snap.docs.map(serializeDoc).sort((a, b) => String(b.createdAt?.seconds || 0).localeCompare(String(a.createdAt?.seconds || 0)));
    res.json({ ok: true, products });
  } catch (error) {
    res.status(500).json({ ok: false, error: "فشل تحميل المنتجات" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const snap = await db.collection("products").doc(req.params.id).get();
    if (!snap.exists || snap.data().active === false) return res.status(404).json({ ok: false, error: "المنتج غير موجود" });
    res.json({ ok: true, product: serializeDoc(snap) });
  } catch {
    res.status(500).json({ ok: false, error: "فشل تحميل المنتج" });
  }
});

app.get("/api/banners", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const snap = await db.collection("banners").where("active", "==", true).get();
    res.json({ ok: true, banners: snap.docs.map(serializeDoc) });
  } catch {
    res.status(500).json({ ok: false, error: "فشل تحميل البانرات" });
  }
});

app.get("/api/offers", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const snap = await db.collection("offers").where("active", "==", true).get();
    res.json({ ok: true, offers: snap.docs.map(serializeDoc) });
  } catch {
    res.status(500).json({ ok: false, error: "فشل تحميل العروض" });
  }
});

// ---------- ADMIN IMAGE UPLOAD ----------
app.post("/api/upload", requireAdmin, upload.array("files", 20), async (req, res) => {
  if (!isImageKitConfigured()) return res.status(503).json({ ok: false, error: "ImageKit غير مُعد" });
  const files = req.files?.length ? req.files : [];
  if (!files.length) return res.status(400).json({ ok: false, error: "لم يتم اختيار أي ملف" });
  try {
    const folder = cleanFolder(req.body.folder || "/axel");
    const results = [];
    for (const file of files) {
      if (!file.mimetype?.startsWith("image/")) return res.status(400).json({ ok: false, error: "مسموح برفع الصور فقط" });
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
    res.status(500).json({ ok: false, error: "فشل رفع الصورة" });
  }
});

app.delete("/api/upload/:fileId", requireAdmin, async (req, res) => {
  if (!isImageKitConfigured()) return res.status(503).json({ ok: false, error: "ImageKit غير مُعد" });
  try {
    await imagekit.deleteFile(req.params.fileId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "فشل حذف الصورة" });
  }
});

// ---------- ADMIN PRODUCTS / BANNERS / OFFERS ----------
app.get("/api/admin/products", requireAdmin, async (req, res) => {
  const snap = await db.collection("products").get();
  res.json({ ok: true, products: snap.docs.map(serializeDoc) });
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const salePrice = Number(body.salePrice || 0);
    const images = asArray(body.images).filter(x => x?.url);
    const colors = asArray(body.colors).map(String).filter(Boolean);
    const sizes = asArray(body.sizes).map(String).filter(Boolean);
    const stock = body.stock && typeof body.stock === "object" ? body.stock : {};
    if (!name || !salePrice || !images.length || !colors.length || !sizes.length) {
      return res.status(400).json({ ok: false, error: "أكمل اسم المنتج والسعر والصور والألوان والمقاسات" });
    }
    const ref = await db.collection("products").add({
      name,
      category: String(body.category || "تصميمات"),
      salePrice,
      oldPrice: Number(body.oldPrice || 0),
      description: String(body.description || ""),
      images,
      colors,
      sizes,
      stock,
      active: body.active !== false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ ok: true, id: ref.id });
  } catch (error) {
    res.status(500).json({ ok: false, error: "فشل حفظ المنتج" });
  }
});

app.patch("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const ref = db.collection("products").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "المنتج غير موجود" });
    const allowed = ["name", "category", "salePrice", "oldPrice", "description", "images", "colors", "sizes", "stock", "active"];
    const patch = {};
    for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key];
    patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.update(patch);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "فشل تعديل المنتج" });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const ref = db.collection("products").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "المنتج غير موجود" });
    const images = asArray(snap.data().images);
    await ref.delete();
    if (isImageKitConfigured()) {
      await Promise.allSettled(images.map(img => img.fileId ? imagekit.deleteFile(img.fileId) : Promise.resolve()));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "فشل حذف المنتج" });
  }
});

app.get("/api/admin/banners", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("banners").get();
    res.json({ ok: true, banners: snap.docs.map(serializeDoc) });
  } catch (error) {
    console.error("Load banners error:", error.message);
    res.status(500).json({ ok: false, error: "تعذر تحميل البانرات من قاعدة البيانات." });
  }
});
app.post("/api/admin/banners", requireAdmin, async (req, res) => {
  try {
    const { imageUrl, fileId } = req.body || {};
    if (!imageUrl) return res.status(400).json({ ok: false, error: "ارفع البانر أولاً." });
    const ref = await db.collection("banners").add({ imageUrl, fileId: fileId || "", active: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(201).json({ ok: true, id: ref.id });
  } catch (error) {
    console.error("Save banner error:", error.message);
    res.status(500).json({ ok: false, error: "فشل حفظ البانر في قاعدة البيانات. راجع إعداد FIREBASE_SERVICE_ACCOUNT_BASE64 في الخادم." });
  }
});
app.patch("/api/admin/banners/:id", requireAdmin, async (req, res) => {
  await db.collection("banners").doc(req.params.id).update({ active: req.body?.active !== false });
  res.json({ ok: true });
});
app.delete("/api/admin/banners/:id", requireAdmin, async (req, res) => {
  const ref = db.collection("banners").doc(req.params.id); const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: "البانر غير موجود" });
  const data = snap.data(); await ref.delete();
  if (data.fileId && isImageKitConfigured()) await Promise.allSettled([imagekit.deleteFile(data.fileId)]);
  res.json({ ok: true });
});

app.post("/api/admin/offers", requireAdmin, async (req, res) => {
  const { title, endsAt } = req.body || {};
  if (!title || !endsAt) return res.status(400).json({ ok: false, error: "أكمل بيانات العرض" });
  const ref = await db.collection("offers").add({ title: String(title), endsAt: new Date(endsAt), active: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  res.status(201).json({ ok: true, id: ref.id });
});

// ---------- ORDERS ----------
app.post("/api/orders", async (req, res) => {
  if (!requireFirebase(res)) return;
  const { productId, color, size, quantity = 1, customerName, phone, address, paymentMethod = "غير محدد" } = req.body || {};
  const qty = Math.max(1, Math.min(10, Number(quantity) || 1));
  if (!productId || !color || !size || !customerName || !phone || !address) return res.status(400).json({ ok: false, error: "بيانات الطلب غير مكتملة" });
  try {
    const productRef = db.collection("products").doc(productId);
    const orderCode = makeOrderCode();
    let orderData;
    const orderRef = await db.runTransaction(async tx => {
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
        orderCode, productId, productName: product.name || "منتج AXEL",
        imageUrl: product.images?.find(x => x.color === color)?.url || product.images?.[0]?.url || "",
        color, size, quantity: qty,
        customerName: String(customerName).trim(), phone: String(phone).trim(), address: String(address).trim(),
        paymentMethod, paymentStatus: "pending", status: "جديد", subtotal, shipping, total: subtotal + shipping,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      const ref = db.collection("orders").doc(); tx.set(ref, orderData); return ref;
    });
    await notifyTelegram({ ...orderData, id: orderRef.id });
    res.status(201).json({ ok: true, orderId: orderRef.id, orderCode, total: orderData.total, paymentStatus: orderData.paymentStatus });
  } catch (error) {
    const map = { PRODUCT_NOT_FOUND: "المنتج غير موجود", PRODUCT_INACTIVE: "هذا المنتج غير متاح حالياً", OUT_OF_STOCK: "الكمية المطلوبة غير متاحة" };
    res.status(400).json({ ok: false, error: map[error.message] || "فشل إنشاء الطلب" });
  }
});

app.get("/api/orders/track", async (req, res) => {
  if (!requireFirebase(res)) return;
  const orderCode = String(req.query.code || "").trim();
  const phone = String(req.query.phone || "").trim();
  if (!orderCode || !phone) return res.status(400).json({ ok: false, error: "اكتب رقم الطلب ورقم الهاتف" });
  try {
    const snap = await db.collection("orders").where("orderCode", "==", orderCode).limit(1).get();
    if (snap.empty) return res.status(404).json({ ok: false, error: "لم يتم العثور على الطلب" });
    const data = snap.docs[0].data();
    if (!String(data.phone || "").replace(/\D/g, "").endsWith(phone.replace(/\D/g, ""))) return res.status(403).json({ ok: false, error: "رقم الهاتف غير مطابق" });
    res.json({ ok: true, order: { orderCode: data.orderCode, productName: data.productName, color: data.color, size: data.size, quantity: data.quantity, total: data.total, status: data.status, paymentMethod: data.paymentMethod, paymentStatus: data.paymentStatus, createdAt: stamp(data.createdAt) } });
  } catch {
    res.status(500).json({ ok: false, error: "تعذر تتبع الطلب الآن" });
  }
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const snap = await db.collection("orders").get();
  const orders = snap.docs.map(serializeDoc).sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
  res.json({ ok: true, orders });
});

app.patch("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  const allowedStatuses = ["جديد", "قيد التجهيز", "تم الشحن", "تم التوصيل", "ملغي", "مرتجع"];
  const allowedPayments = ["pending", "paid", "failed", "refunded"];
  const patch = {};
  if (allowedStatuses.includes(req.body?.status)) patch.status = req.body.status;
  if (allowedPayments.includes(req.body?.paymentStatus)) patch.paymentStatus = req.body.paymentStatus;
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await db.collection("orders").doc(req.params.id).update(patch);
  res.json({ ok: true });
});

app.post("/api/visits", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const key = new Date().toISOString().slice(0, 10);
    await db.collection("analytics").doc(key).set({ visits: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [products, orders, analytics] = await Promise.all([db.collection("products").get(), db.collection("orders").get(), db.collection("analytics").get()]);
    let sales = 0, paid = 0, visits = 0;
    orders.forEach(doc => { const o = doc.data(); sales += Number(o.total || 0); if (o.paymentStatus === "paid") paid += Number(o.total || 0); });
    analytics.forEach(doc => visits += Number(doc.data().visits || 0));
    res.json({ ok: true, stats: { products: products.size, orders: orders.size, sales, paidSales: paid, visits } });
  } catch { res.status(500).json({ ok: false, error: "فشل تحميل الإحصائيات" }); }
});

app.post("/api/payments/webhook", (req, res) => res.status(501).json({ ok: false, error: "اربط بيانات بوابة الدفع أولاً ثم فعّل التحقق الخاص بالبوابة قبل استقبال Webhook." }));

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
