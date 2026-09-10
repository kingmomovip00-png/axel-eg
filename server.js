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

function paymobConfigured() {
  return Boolean(
    process.env.PAYMOB_BASE_URL &&
    process.env.PAYMOB_SECRET_KEY &&
    process.env.PAYMOB_PUBLIC_KEY &&
    process.env.PAYMOB_HMAC_SECRET &&
    process.env.PAYMOB_INTEGRATION_ID_CARD
  );
}

function paymobBool(value) { return value === true ? "true" : value === false ? "false" : String(value ?? ""); }
function verifyPaymobHmac(obj, received) {
  if (!obj || !received || !process.env.PAYMOB_HMAC_SECRET) return false;
  const fields = [
    obj.amount_cents, obj.created_at, obj.currency, obj.error_occured,
    obj.has_parent_transaction, obj.id, obj.integration_id, obj.is_3d_secure,
    obj.is_auth, obj.is_capture, obj.is_refunded, obj.is_standalone_payment,
    obj.is_voided, obj.order?.id, obj.owner, obj.pending,
    obj.source_data?.pan, obj.source_data?.sub_type, obj.source_data?.type, obj.success
  ];
  const value = fields.map(paymobBool).join("");
  const digest = crypto.createHmac("sha512", process.env.PAYMOB_HMAC_SECRET).update(value).digest("hex");
  try {
    return digest.length === received.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(received));
  } catch { return false; }
}

function splitCustomerName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || "AXEL", lastName: parts.join(" ") || "Customer" };
}

async function notifyTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const text = ["🛍️ طلب جديد - AXEL",`رقم الطلب: ${order.orderCode}`,`العميل: ${order.customerName}`,`الهاتف: ${order.phone}`,`المنتج: ${order.productName}`,`اللون: ${order.color}`,`المقاس: ${order.size}`,`الكمية: ${order.quantity}`,`الإجمالي: ${order.total} جنيه`,`طريقة الدفع: ${order.paymentMethod}`,`حالة الدفع: ${order.paymentStatus}`,`العنوان: ${order.address}`].join("\n");
  try { const imageUrl=String(order.imageUrl||"").trim(); const endpoint=imageUrl?"sendPhoto":"sendMessage"; const body=imageUrl?{chat_id:chatId,photo:imageUrl,caption:text}:{chat_id:chatId,text}; await fetch(`https://api.telegram.org/bot${token}/${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); } catch(error){ console.error("Telegram notification failed:",error.message); }
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
  const snap = await db.collection("banners").get();
  res.json({ ok: true, banners: snap.docs.map(serializeDoc) });
});
app.post("/api/admin/banners", requireAdmin, async (req, res) => {
  const { imageUrl, fileId } = req.body || {};
  if (!imageUrl) return res.status(400).json({ ok: false, error: "ارفع البانر أولاً" });
  const ref = await db.collection("banners").add({ imageUrl, fileId: fileId || "", active: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  res.status(201).json({ ok: true, id: ref.id });
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
  const { productId, color, size, quantity = 1, customerName, phone, email, address, paymentMethod = "غير محدد" } = req.body || {};
  const qty = Math.max(1, Math.min(10, Number(quantity) || 1));
  if (!productId || !color || !size || !customerName || !phone || !email || !address) return res.status(400).json({ ok: false, error: "أكمل الاسم والهاتف والبريد الإلكتروني والعنوان واختيارات المنتج" });
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
        customerName: String(customerName).trim(), phone: String(phone).trim(), email: String(email).trim().toLowerCase(), address: String(address).trim(),
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

app.post("/api/paymob/checkout", async (req, res) => {
  if (!requireFirebase(res)) return;
  if (!paymobConfigured()) return res.status(503).json({ ok: false, error: "بوابة Paymob لم تُفعّل بعد. أضف بيانات Paymob الحقيقية إلى متغيرات البيئة أولاً." });
  const orderId = String(req.body?.orderId || "").trim();
  if (!orderId) return res.status(400).json({ ok: false, error: "رقم الطلب غير موجود" });
  try {
    const ref = db.collection("orders").doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "الطلب غير موجود" });
    const order = snap.data();
    if (order.paymentMethod !== "Paymob") return res.status(400).json({ ok: false, error: "هذا الطلب ليس دفعه إلكترونية" });
    const amount = Math.round(Number(order.total || 0) * 100);
    const integrationId = Number(process.env.PAYMOB_INTEGRATION_ID_CARD);
    if (!Number.isInteger(integrationId) || integrationId <= 0) return res.status(503).json({ ok: false, error: "PAYMOB_INTEGRATION_ID_CARD غير مضبوط بشكل صحيح" });
    const customer = splitCustomerName(order.customerName);
    const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const base = String(process.env.PAYMOB_BASE_URL).replace(/\/$/, "");
    const payload = {
      amount, currency: "EGP", payment_methods: [integrationId],
      items: [
        { name: order.productName || "منتج AXEL", amount: Math.round(Number(order.subtotal || 0) * 100 / Math.max(1, Number(order.quantity || 1))), quantity: Number(order.quantity || 1), description: "AXEL Oversize T-shirt" },
        { name: "الشحن", amount: Math.round(Number(order.shipping || 0) * 100), quantity: 1, description: "شحن الطلب" }
      ],
      billing_data: { first_name: customer.firstName, last_name: customer.lastName, email: order.email, phone_number: order.phone, apartment: "NA", floor: "NA", street: order.address, building: "NA", shipping_method: "NA", postal_code: "NA", city: "NA", state: "NA", country: "EG" },
      customer: { first_name: customer.firstName, last_name: customer.lastName, email: order.email },
      special_reference: order.orderCode,
      notification_url: `${appUrl}/api/paymob/webhook`,
      redirection_url: `${appUrl}/checkout.html?payment=return&order=${encodeURIComponent(order.orderCode)}`
    };
    const r = await fetch(`${base}/v1/intention/`, { method: "POST", headers: { Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.client_secret) {
      console.error("Paymob intention error", r.status, data);
      return res.status(502).json({ ok: false, error: "تعذر إنشاء عملية الدفع من Paymob. راجع بيانات Paymob وحالة Integration ID." });
    }
    await ref.update({ paymobIntentionId: data.id || null, paymobOrderId: data.intention_order_id || data.order_id || null, paymentStatus: "pending", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    const checkoutUrl = `${base}/unifiedcheckout/?publicKey=${encodeURIComponent(process.env.PAYMOB_PUBLIC_KEY)}&clientSecret=${encodeURIComponent(data.client_secret)}`;
    res.json({ ok: true, checkoutUrl });
  } catch (error) {
    console.error("Paymob checkout error", error.message);
    res.status(502).json({ ok: false, error: "تعذر الاتصال ببوابة Paymob حالياً" });
  }
});

app.get("/api/orders/status", async (req, res) => {
  if (!requireFirebase(res)) return;
  const code = String(req.query.code || "").trim();
  if (!code) return res.status(400).json({ ok: false, error: "رقم الطلب غير موجود" });
  const snap = await db.collection("orders").where("orderCode", "==", code).limit(1).get();
  if (snap.empty) return res.status(404).json({ ok: false, error: "الطلب غير موجود" });
  const d = snap.docs[0].data();
  res.json({ ok: true, order: { orderCode: d.orderCode, paymentStatus: d.paymentStatus, status: d.status, total: d.total } });
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

app.post("/api/paymob/webhook", async (req, res) => {
  if (!paymobConfigured()) return res.status(503).json({ ok: false, error: "Paymob غير مُعد" });
  const obj = req.body?.obj;
  const receivedHmac = String(req.query?.hmac || "");
  if (!verifyPaymobHmac(obj, receivedHmac)) return res.status(401).json({ ok: false, error: "Invalid Paymob HMAC" });
   const merchantOrderId=String(obj?.order?.merchant_order_id||"").trim();
   const paymobOrderId=String(obj?.order?.id||"").trim();
   if(!merchantOrderId&&!paymobOrderId)return res.status(400).json({ok:false,error:"Paymob order reference missing"});
   try {
     let snap=merchantOrderId?await db.collection("orders").where("orderCode","==",merchantOrderId).limit(1).get():{empty:true,docs:[]};
     if(snap.empty&&paymobOrderId){ snap=await db.collection("orders").where("paymobOrderId","==",Number(paymobOrderId)).limit(1).get(); if(snap.empty)snap=await db.collection("orders").where("paymobOrderId","==",paymobOrderId).limit(1).get(); }
     if(snap.empty)return res.status(404).json({ok:false,error:"AXEL order not found"});
    const orderRef = snap.docs[0].ref;
    const current = snap.docs[0].data();
    const success = obj.success === true && obj.pending === false;
    const failed = obj.success === false && obj.pending === false;
    let changed = false;
    await db.runTransaction(async tx => {
      const fresh = await tx.get(orderRef);
      if (!fresh.exists) throw new Error("ORDER_NOT_FOUND");
      const order = fresh.data();
      const patch = { paymobTransactionId: obj.id || null, paymobOrderId: obj.order?.id || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (success && order.paymentStatus !== "paid") { patch.paymentStatus = "paid"; patch.status = order.status === "ملغي" ? "جديد" : order.status; changed = true; }
      else if (failed && order.paymentStatus !== "failed") {
        patch.paymentStatus = "failed"; patch.status = "ملغي";
        if (!order.stockRestored) {
          const productRef = db.collection("products").doc(order.productId);
          const productSnap = await tx.get(productRef);
          if (productSnap.exists) {
            const product = productSnap.data();
            const stock = structuredClone(product.stock || {}); stock[order.color] = stock[order.color] || {};
            stock[order.color][order.size] = Number(stock[order.color][order.size] || 0) + Number(order.quantity || 0);
            tx.update(productRef, { stock, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          }
          patch.stockRestored = true;
        }
        changed = true;
      }
      tx.update(orderRef, patch);
    });
    if (changed) await notifyTelegram({ ...current, paymentStatus: success ? "paid" : "failed", status: success ? current.status : "ملغي" });
    res.json({ ok: true, received: true });
  } catch (error) {
    console.error("Paymob webhook error", error.message);
    res.status(500).json({ ok: false, error: "تعذر تحديث حالة الطلب" });
  }
});

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
