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
const env = (name, fallback = "") => {
  const value = process.env[name];
  if (value == null) return fallback;
  return String(value).trim().replace(/^(["'])(.*)\1$/, "$2").trim();
};
const ADMIN_EMAIL = env("ADMIN_EMAIL", "axel.support.eg@gmail.com").toLowerCase();
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
  publicKey: env("IMAGEKIT_PUBLIC_KEY"),
  privateKey: env("IMAGEKIT_PRIVATE_KEY"),
  urlEndpoint: env("IMAGEKIT_URL_ENDPOINT")
});

const isImageKitConfigured = () => Boolean(
  env("IMAGEKIT_PUBLIC_KEY") && env("IMAGEKIT_PRIVATE_KEY") && env("IMAGEKIT_URL_ENDPOINT")
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


function kashierConfigured() {
  return Boolean(env("KASHIER_SECRET_KEY") && env("KASHIER_API_KEY") && env("KASHIER_MERCHANT_ID"));
}
function kashierBaseUrl() {
  const mode = env("KASHIER_MODE", "live").toLowerCase();
  return mode === "test" ? "https://test-api.kashier.io" : "https://api.kashier.io";
}
function appBaseUrl(req) {
  return (env("APP_URL") || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}
function kashierWebhookSignature(data, apiKey) {
  const keys = Array.isArray(data?.signatureKeys) ? [...data.signatureKeys].sort() : [];
  const payload = keys.map(k => `${k}=${encodeURIComponent(String(data?.[k] ?? ""))}`).join("&");
  return crypto.createHmac("sha256", apiKey).update(payload).digest("hex");
}
function verifyKashierWebhook(data, received) {
  if (!data || !received || !env("KASHIER_API_KEY")) return false;
  const expected = kashierWebhookSignature(data, env("KASHIER_API_KEY"));
  try { return expected.length === received.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)); } catch { return false; }
}
function restoreOrderInventoryTx(tx, order) {
  const restoreItems = Array.isArray(order.items) && order.items.length ? order.items : [{ productId: order.productId, color: order.color, size: order.size, quantity: order.quantity }];
  return (async () => {
    if (order.couponCode) {
      const couponRef = db.collection("coupons").doc(String(order.couponCode).toUpperCase());
      const couponSnap = await tx.get(couponRef);
      if (couponSnap.exists) tx.update(couponRef, { usedCount: admin.firestore.FieldValue.increment(-1), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    for (const it of restoreItems) {
      const productRef = db.collection("products").doc(it.productId);
      const productSnap = await tx.get(productRef);
      if (!productSnap.exists) continue;
      const product = productSnap.data();
      const stock = structuredClone(product.stock || {});
      stock[it.color] = stock[it.color] || {};
      stock[it.color][it.size] = Number(stock[it.color][it.size] || 0) + Number(it.quantity || 0);
      tx.update(productRef, { stock, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  })();
}

function paypalConfigured() {
  return Boolean(env("PAYPAL_CLIENT_ID") && env("PAYPAL_CLIENT_SECRET"));
}
function paypalBaseUrl() { return env("PAYPAL_MODE", "live").toLowerCase() === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com"; }
async function paypalAccessToken() {
  const auth = Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`).toString("base64");
  const r = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("PAYPAL_AUTH_FAILED");
  return d.access_token;
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
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{productName:order.productName,color:order.color,size:order.size,quantity:order.quantity}];
  const itemText = items.map((it,i)=>`${i+1}) ${it.productName||"منتج AXEL"} — ${it.color||""} — ${it.size||""} × ${Number(it.quantity||1)}`).join("\n");
  const text = ["🛍️ طلب جديد - AXEL",`رقم الطلب: ${order.orderCode}`,`العميل: ${order.customerName}`,`الهاتف: ${order.phone}`,`المنتجات:\n${itemText}`,`الإجمالي: ${order.total} جنيه`,`الخصم: ${order.discount||0} جنيه`,order.couponCode?`الكوبون: ${order.couponCode}`:"",`طريقة الدفع: ${order.paymentMethod}`,`حالة الدفع: ${order.paymentStatus}`,`العنوان: ${order.address}`].filter(Boolean).join("\n");
  try { const imageUrl=String(order.imageUrl||items[0]?.imageUrl||"").trim(); const endpoint=imageUrl?"sendPhoto":"sendMessage"; const body=imageUrl?{chat_id:chatId,photo:imageUrl,caption:text}:{chat_id:chatId,text}; await fetch(`https://api.telegram.org/bot${token}/${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); } catch(error){ console.error("Telegram notification failed:",error.message); }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "AXEL backend", imagekit: isImageKitConfigured(), firebaseAdmin: firebaseReady });
});
app.get("/api/config", (req, res) => res.json({ ok: true, imagekitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || null }));

app.get("/api/payment-methods", (req,res)=>res.json({ok:true,kashier:kashierConfigured(),paypal:paypalConfigured()}));

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

app.get("/api/banners/:id", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const snap = await db.collection("banners").doc(req.params.id).get();
    if (!snap.exists || snap.data().active === false) return res.status(404).json({ ok: false, error: "البانر غير موجود" });
    res.json({ ok: true, banner: serializeDoc(snap) });
  } catch { res.status(500).json({ ok: false, error: "فشل تحميل البانر" }); }
});

// ---------- IMAGEKIT DIRECT-UPLOAD AUTH ----------
// Vercel Functions have a request-body limit, so the browser uploads images
// directly to ImageKit. This endpoint only signs the short-lived upload request.
app.get("/api/imagekit/auth", requireAdmin, async (req, res) => {
  if (!isImageKitConfigured()) {
    return res.status(503).json({ ok: false, error: "ImageKit غير مُعد. راجع متغيرات ImageKit في Vercel." });
  }
  try {
    const expire = Math.floor(Date.now() / 1000) + 60 * 30;
    const token = crypto.randomBytes(32).toString("hex");
    const signature = crypto.createHmac("sha1", env("IMAGEKIT_PRIVATE_KEY"))
      .update(`${token}${expire}`)
      .digest("hex");
    res.json({
      ok: true,
      token,
      expire,
      signature,
      publicKey: env("IMAGEKIT_PUBLIC_KEY"),
      uploadUrl: "https://upload.imagekit.io/api/v1/files/upload",
      expiresInSeconds: 1800
    });
  } catch (error) {
    console.error("ImageKit auth error:", error.message);
    res.status(500).json({ ok: false, error: "تعذر تجهيز رفع الصور." });
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
      offerPrice: Number(body.offerPrice || 0),
      offerColor: String(body.offerColor || ""),
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
    const allowed = ["name", "category", "salePrice", "oldPrice", "description", "offerPrice", "offerColor", "images", "colors", "sizes", "stock", "active"];
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
  const { imageUrl, videoUrl, fileId, productId, offerPrice, offerColor, mediaType, placement } = req.body || {};
  const type = mediaType === "video" ? "video" : "image";
  const mediaUrl = type === "video" ? String(videoUrl || "") : String(imageUrl || "");
  if (!mediaUrl) return res.status(400).json({ ok: false, error: "ارفع الملف أولاً" });
  if (type === "video" && placement === "hero" && !String(videoUrl || "")) return res.status(400).json({ ok:false,error:"الفيديو الرئيسي يحتاج رابط فيديو صالح" });
  const price = Number(offerPrice || 0);
  if (placement === "hero" && type === "video" && !productId) return res.status(400).json({ ok:false,error:"اربط الفيديو بمنتج حتى يفتح التيشيرت الصحيح عند الضغط عليه" });
  if (productId) { const p = await db.collection("products").doc(String(productId)).get(); if (!p.exists) return res.status(400).json({ ok: false, error: "المنتج المرتبط بالعرض غير موجود" }); }
  const ref = await db.collection("banners").add({ mediaType:type, imageUrl:type==='image'?mediaUrl:'', videoUrl:type==='video'?mediaUrl:'', fileId:fileId||'', productId:productId||'', offerPrice:price, offerColor:String(offerColor||''), placement:placement==='mid'?'mid':'hero', active:true, createdAt:admin.firestore.FieldValue.serverTimestamp() });
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

// ---------- COUPONS ----------
app.get("/api/coupons/validate", async (req, res) => {
  if (!requireFirebase(res)) return;
  const code = String(req.query.code || "").trim().toUpperCase();
  const subtotal = Math.max(0, Number(req.query.subtotal || 0));
  const quantity = Math.max(1, Number(req.query.quantity || 1));
  let items = [];
  try { items = req.query.items ? JSON.parse(String(req.query.items)) : []; } catch {}
  if (!code) return res.status(400).json({ ok: false, error: "اكتب كود الخصم" });
  try {
    const snap = await db.collection("coupons").doc(code).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "كود الخصم غير صحيح" });
    const c = snap.data(); const now = Date.now();
    if (c.active === false || (c.expiresAt && new Date(c.expiresAt.toDate ? c.expiresAt.toDate() : c.expiresAt).getTime() < now) || (Number(c.usageLimit || 0) > 0 && Number(c.usedCount || 0) >= Number(c.usageLimit))) return res.status(400).json({ ok: false, error: "كود الخصم غير متاح حالياً" });
    const targetIds = Array.isArray(c.productIds) ? c.productIds.map(String).filter(Boolean) : [];
    const hasTargeting = targetIds.length > 0;
    const eligibleItems = hasTargeting ? items.filter(x => targetIds.includes(String(x.productId))) : items;
    const eligibleSubtotal = eligibleItems.length ? eligibleItems.reduce((a,x)=>a + Number(x.unitPrice||0)*Number(x.quantity||0), 0) : (hasTargeting ? 0 : subtotal);
    const eligibleQty = eligibleItems.length ? eligibleItems.reduce((a,x)=>a + Number(x.quantity||0), 0) : (hasTargeting ? 0 : quantity);
    if (hasTargeting && !eligibleItems.length) return res.status(400).json({ ok: false, error: "هذا الكود مخصص لمنتج معين، اختر المنتج المشمول بالعرض أولاً" });
    if (eligibleSubtotal < Number(c.minOrder || 0)) return res.status(400).json({ ok: false, error: `الحد الأدنى للطلب لاستخدام الكود هو ${Number(c.minOrder || 0)} ج` });
    if (eligibleQty < Number(c.minQuantity || 1)) return res.status(400).json({ ok: false, error: `يجب شراء ${Number(c.minQuantity || 1)} قطع من المنتجات المشمولة على الأقل لاستخدام الكود` });
    let discount = c.type === "fixed" ? Math.min(eligibleSubtotal, Number(c.value || 0)) : eligibleSubtotal * Math.min(100, Number(c.value || 0)) / 100;
    if (Number(c.maxDiscount || 0) > 0) discount = Math.min(discount, Number(c.maxDiscount));
    discount = Math.max(0, Math.round(discount * 100) / 100);
    res.json({ ok: true, coupon: { code, type: c.type, value: Number(c.value || 0), discount, minOrder: Number(c.minOrder || 0), minQuantity:Number(c.minQuantity||1), maxDiscount: Number(c.maxDiscount || 0), productIds: targetIds } });
  } catch { res.status(500).json({ ok: false, error: "تعذر التحقق من الكود" }); }
});

app.get("/api/coupons/featured", async (req,res)=>{
  if(!requireFirebase(res))return;
  try{const snap=await db.collection("coupons").where("active","==",true).where("showOnHome","==",true).limit(10).get(); const now=Date.now(); const list=snap.docs.map(serializeDoc).filter(c=>!(c.expiresAt&&new Date(c.expiresAt?.seconds?c.expiresAt.seconds*1000:c.expiresAt).getTime()<now)&&(!Number(c.usageLimit||0)||Number(c.usedCount||0)<Number(c.usageLimit||0))); const c=list[0]; if(!c)return res.json({ok:true,coupon:null}); res.json({ok:true,coupon:{code:c.code,type:c.type,value:Number(c.value||0),minOrder:Number(c.minOrder||0),minQuantity:Number(c.minQuantity||1),usageLimit:Number(c.usageLimit||0),usedCount:Number(c.usedCount||0),title:c.promoTitle||"خصم خاص",text:c.promoText||"استخدم الكود عند الطلب"}}); }catch{res.status(500).json({ok:false,error:"تعذر تحميل العرض"});}
});

app.get("/api/products/:id/reviews", async (req, res) => {
  if (!requireFirebase(res)) return;
  try { const snap = await db.collection("reviews").where("productId", "==", req.params.id).where("approved", "==", true).get(); const reviews=snap.docs.map(serializeDoc).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0)); res.json({ok:true,reviews}); } catch { res.status(500).json({ok:false,error:"تعذر تحميل التقييمات"}); }
});
app.get("/api/reviews", async (req, res) => {
  if (!requireFirebase(res)) return;
  try { const snap = await db.collection("reviews").where("approved", "==", true).get(); const reviews=snap.docs.map(serializeDoc).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0)).slice(0,50); res.json({ok:true,reviews}); } catch { res.status(500).json({ok:false,error:"تعذر تحميل التقييمات"}); }
});
app.post("/api/reviews", async (req,res)=>{
  if(!requireFirebase(res))return; const {productId,name,rating,comment}=req.body||{}; const r=Math.round(Number(rating||0)); if(!productId||!String(name||'').trim()||r<1||r>5||!String(comment||'').trim()) return res.status(400).json({ok:false,error:"اكتب الاسم والتقييم والرأي"});
  try { const p=await db.collection("products").doc(String(productId)).get(); if(!p.exists||p.data().active===false)return res.status(404).json({ok:false,error:"المنتج غير موجود"}); await db.collection("reviews").add({productId:String(productId),productName:p.data().name||"منتج AXEL",name:String(name).trim().slice(0,80),rating:r,comment:String(comment).trim().slice(0,800),approved:true,createdAt:admin.firestore.FieldValue.serverTimestamp()}); res.status(201).json({ok:true,message:"تم إضافة رأيك بنجاح"}); } catch { res.status(500).json({ok:false,error:"تعذر حفظ الرأي"}); }
});

// ---------- ADMIN COUPONS ----------
app.get("/api/admin/coupons", requireAdmin, async (req,res)=>{ const snap=await db.collection("coupons").get(); res.json({ok:true,coupons:snap.docs.map(serializeDoc)}); });
app.post("/api/admin/coupons", requireAdmin, async (req,res)=>{ const b=req.body||{}, code=String(b.code||'').trim().toUpperCase(), type=b.type==='fixed'?'fixed':'percent', value=Number(b.value||0); if(!code||!/^[A-Z0-9_-]{3,30}$/.test(code)||value<=0)return res.status(400).json({ok:false,error:"أدخل كودًا صحيحًا وقيمة الخصم"}); const ref=db.collection("coupons").doc(code); if((await ref.get()).exists)return res.status(400).json({ok:false,error:"كود الخصم موجود بالفعل"}); await ref.set({code,type,value,minOrder:Number(b.minOrder||0),minQuantity:Math.max(1,Number(b.minQuantity||1)),maxDiscount:Number(b.maxDiscount||0),usageLimit:Number(b.usageLimit||0),usedCount:0,showOnHome:Boolean(b.showOnHome),productIds:Array.isArray(b.productIds)?b.productIds.map(String).filter(Boolean):[],promoTitle:String(b.promoTitle||"خصم خاص"),promoText:String(b.promoText||"استخدم الكود عند الطلب"),expiresAt:b.expiresAt?new Date(b.expiresAt):null,active:b.active!==false,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()}); res.status(201).json({ok:true}); });
app.patch("/api/admin/coupons/:id", requireAdmin, async (req,res)=>{ const patch={},b=req.body||{}; for(const k of ['type','value','minOrder','minQuantity','maxDiscount','usageLimit','active','showOnHome','productIds']) if(k in b) patch[k]=k==='type'?(b[k]==='fixed'?'fixed':'percent'):k==='productIds'?(Array.isArray(b[k])?b[k].map(String).filter(Boolean):[]):['active','showOnHome'].includes(k)?Boolean(b[k]):Number(b[k]||0); if('expiresAt' in b)patch.expiresAt=b.expiresAt?new Date(b.expiresAt):null; if('promoTitle' in b)patch.promoTitle=String(b.promoTitle||""); if('promoText' in b)patch.promoText=String(b.promoText||""); patch.updatedAt=admin.firestore.FieldValue.serverTimestamp(); await db.collection('coupons').doc(String(req.params.id).toUpperCase()).update(patch); res.json({ok:true}); });
app.delete("/api/admin/coupons/:id", requireAdmin, async (req,res)=>{ await db.collection('coupons').doc(String(req.params.id).toUpperCase()).delete(); res.json({ok:true}); });

// ---------- ORDERS ----------
app.post("/api/orders", async (req, res) => {
  if (!requireFirebase(res)) return;
  const body=req.body||{};
  const items=Array.isArray(body.items)&&body.items.length?body.items.map(x=>({productId:String(x.productId||""),color:String(x.color||""),size:String(x.size||""),quantity:Math.max(1,Math.min(20,Number(x.quantity)||1)),bannerId:String(x.bannerId||"")})).filter(x=>x.productId&&x.color&&x.size):[{productId:String(body.productId||""),color:String(body.color||""),size:String(body.size||""),quantity:Math.max(1,Math.min(20,Number(body.quantity)||1)),bannerId:String(body.bannerId||"")}].filter(x=>x.productId&&x.color&&x.size);
  const { customerName, phone, email, address, paymentMethod = "غير محدد", couponCode = "" } = body;
  if (!items.length || !customerName || !phone || !email || !address) return res.status(400).json({ ok: false, error: "أكمل بيانات العميل والمنتجات" });
  try {
    const orderCode=makeOrderCode(); let orderData;
    const orderRef=await db.runTransaction(async tx=>{
      const productRefs=items.map(i=>db.collection("products").doc(i.productId));
      const snaps=[]; for(const ref of productRefs) snaps.push(await tx.get(ref));
      const prepared=[]; let subtotal=0;
      for(let i=0;i<items.length;i++){
        const it=items[i], snap=snaps[i]; if(!snap.exists)throw new Error("PRODUCT_NOT_FOUND"); const p=snap.data(); if(p.active===false)throw new Error("PRODUCT_INACTIVE");
        const available=Number(p.stock?.[it.color]?.[it.size]||0); if(available<it.quantity)throw new Error("OUT_OF_STOCK");
        let unitPrice=Number(p.salePrice||0), offerApplied=false;
        if(it.bannerId){const bs=await tx.get(db.collection("banners").doc(it.bannerId));const b=bs.exists?bs.data():null;if(!b||b.active===false||String(b.productId||"")!==it.productId||Number(b.offerPrice||0)<=0)throw new Error("INVALID_BANNER_OFFER");unitPrice=Number(b.offerPrice);offerApplied=true;}
        const nextStock=structuredClone(p.stock||{}); nextStock[it.color]=nextStock[it.color]||{}; nextStock[it.color][it.size]=available-it.quantity; tx.update(productRefs[i],{stock:nextStock,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
        subtotal+=unitPrice*it.quantity; prepared.push({productId:it.productId,productName:p.name||"منتج AXEL",imageUrl:p.images?.find(x=>x.color===it.color)?.url||p.images?.[0]?.url||"",color:it.color,size:it.size,quantity:it.quantity,unitPrice,offerApplied,bannerId:it.bannerId});
      }
      const shipping=Number(process.env.SHIPPING_PRICE||50); let discount=0,appliedCoupon="";
      if(couponCode){const code=String(couponCode).trim().toUpperCase(),cs=await tx.get(db.collection("coupons").doc(code));if(!cs.exists)throw new Error("COUPON_INVALID");const c=cs.data(),now=Date.now(),targetIds=Array.isArray(c.productIds)?c.productIds.map(String):[],eligible=targetIds.length?prepared.filter(x=>targetIds.includes(String(x.productId))):prepared,eligibleSubtotal=eligible.reduce((a,x)=>a+Number(x.unitPrice||0)*Number(x.quantity||0),0),eligibleQty=eligible.reduce((a,x)=>a+Number(x.quantity||0),0);if(c.active===false||(c.expiresAt&&new Date(c.expiresAt.toDate?c.expiresAt.toDate():c.expiresAt).getTime()<now)||(Number(c.usageLimit||0)>0&&Number(c.usedCount||0)>=Number(c.usageLimit)))throw new Error("COUPON_INVALID");if(targetIds.length&&!eligible.length)throw new Error("COUPON_PRODUCT");if(eligibleSubtotal<Number(c.minOrder||0))throw new Error("COUPON_MIN_ORDER");if(eligibleQty<Number(c.minQuantity||1))throw new Error("COUPON_MIN_QTY");discount=c.type==='fixed'?Math.min(eligibleSubtotal,Number(c.value||0)):eligibleSubtotal*Math.min(100,Number(c.value||0))/100;if(Number(c.maxDiscount||0)>0)discount=Math.min(discount,Number(c.maxDiscount));discount=Math.max(0,Math.round(discount*100)/100);appliedCoupon=code;tx.update(cs.ref,{usedCount:admin.firestore.FieldValue.increment(1),updatedAt:admin.firestore.FieldValue.serverTimestamp()});}
      const total=Math.max(0,subtotal-discount+shipping); const first=prepared[0];
      orderData={orderCode,items:prepared,productId:first.productId,productName:first.productName,imageUrl:first.imageUrl,color:first.color,size:first.size,quantity:first.quantity,unitPrice:first.unitPrice,offerApplied:first.offerApplied,bannerId:first.bannerId,couponCode:appliedCoupon,discount,customerName:String(customerName).trim(),phone:String(phone).trim(),email:String(email).trim().toLowerCase(),address:String(address).trim(),paymentMethod,paymentStatus:"pending",status:"جديد",subtotal,shipping,total,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()};
      const ref=db.collection("orders").doc();tx.set(ref,orderData);return ref;
    });
    await notifyTelegram({...orderData,id:orderRef.id});res.status(201).json({ok:true,orderId:orderRef.id,orderCode,total:orderData.total,paymentStatus:orderData.paymentStatus});
  }catch(error){const map={PRODUCT_NOT_FOUND:"المنتج غير موجود",PRODUCT_INACTIVE:"هناك منتج غير متاح حالياً",OUT_OF_STOCK:"إحدى الكميات المطلوبة غير متاحة",INVALID_BANNER_OFFER:"العرض المرتبط بالبانر غير صالح",COUPON_INVALID:"كود الخصم غير صالح أو منتهي أو استنفد عدد استخداماته",COUPON_MIN_ORDER:"الحد الأدنى للطلب لاستخدام الكود لم يتحقق",COUPON_MIN_QTY:"يجب شراء عدد القطع المطلوب للكوبون",COUPON_PRODUCT:"هذا الكود مخصص لمنتج معين، اختر المنتج المشمول بالعرض"};res.status(400).json({ok:false,error:map[error.message]||"فشل إنشاء الطلب"});}
});


app.post("/api/kashier/checkout", async (req, res) => {
  if (!requireFirebase(res)) return;
  if (!kashierConfigured()) return res.status(503).json({ ok:false, error:"بوابة Kashier غير مُفعّلة بعد. أضف KASHIER_SECRET_KEY وKASHIER_API_KEY وKASHIER_MERCHANT_ID." });
  const orderId=String(req.body?.orderId||"").trim(), requestedMethod=String(req.body?.method||"card").toLowerCase();
  if(!orderId)return res.status(400).json({ok:false,error:"رقم الطلب غير موجود"});
  try{
    const ref=db.collection("orders").doc(orderId),snap=await ref.get();if(!snap.exists)return res.status(404).json({ok:false,error:"الطلب غير موجود"});
    const order=snap.data();if(order.paymentMethod!="Kashier")return res.status(400).json({ok:false,error:"هذا الطلب ليس دفعًا إلكترونيًا عبر Kashier"});
    if(order.paymentStatus==='paid')return res.status(400).json({ok:false,error:"تم دفع هذا الطلب بالفعل"});
    const appUrl=appBaseUrl(req), methods=requestedMethod==='wallet'?'wallet':'card';
    const payload={expireAt:new Date(Date.now()+30*60*1000).toISOString(),maxFailureAttempts:3,paymentType:"credit",amount:Number(order.total||0).toFixed(2),currency:"EGP",order:order.orderCode,merchantRedirect:`${appUrl}/checkout.html?payment=kashier&order=${encodeURIComponent(order.orderCode)}`,display:"ar",type:"one-time",allowedMethods:methods,merchantId:env("KASHIER_MERCHANT_ID"),failureRedirect:false,brandColor:env("KASHIER_BRAND_COLOR","#3caeb8"),defaultMethod:methods,description:`AXEL Order ${order.orderCode}`,manualCapture:false,customer:{email:order.email,reference:order.orderCode},interactionSource:"ECOMMERCE",enable3DS:true,serverWebhook:`${appUrl}/api/kashier/webhook`,metaData:{displayNotes:{orderCode:order.orderCode}}};
    const base=kashierBaseUrl();const r=await fetch(`${base}/v3/payment/sessions`,{method:'POST',headers:{Authorization:env("KASHIER_SECRET_KEY"),'api-key':env("KASHIER_API_KEY"),'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.sessionUrl){console.error('Kashier session error',r.status,data);return res.status(502).json({ok:false,error:"تعذر إنشاء جلسة الدفع من Kashier. راجع مفاتيح Kashier وMerchant ID وطرق الدفع المفعلة."});}
    await ref.update({kashierSessionId:data._id||data.sessionId||null,kashierOrderId:data.order||order.orderCode,paymentStatus:'pending',updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    res.json({ok:true,checkoutUrl:data.sessionUrl,sessionId:data._id||data.sessionId||null});
  }catch(e){console.error('Kashier checkout error',e);res.status(502).json({ok:false,error:"تعذر الاتصال ببوابة Kashier حالياً"});}
});

app.get("/api/kashier/status", async (req,res)=>{
  if(!requireFirebase(res))return;
  if(!kashierConfigured())return res.status(503).json({ok:false,error:"Kashier غير مُعد"});
  const code=String(req.query.code||"").trim();if(!code)return res.status(400).json({ok:false,error:"رقم الطلب غير موجود"});
  try{const snap=await db.collection('orders').where('orderCode','==',code).limit(1).get();if(snap.empty)return res.status(404).json({ok:false,error:'الطلب غير موجود'});const ref=snap.docs[0].ref,order=snap.docs[0].data();if(order.paymentStatus!=='pending'||!order.kashierSessionId)return res.json({ok:true,paymentStatus:order.paymentStatus});const r=await fetch(`${kashierBaseUrl()}/v3/payment/sessions/${encodeURIComponent(order.kashierSessionId)}/payment`,{headers:{Authorization:env('KASHIER_SECRET_KEY')}});const d=await r.json().catch(()=>({}));const status=String(d?.data?.status||d?.status||'').toUpperCase();if(['PAID','AUTHORIZED'].includes(status)){await ref.update({paymentStatus:'paid',status:order.status==='ملغي'?'جديد':order.status,kashierPaymentStatus:status,updatedAt:admin.firestore.FieldValue.serverTimestamp()});return res.json({ok:true,paymentStatus:'paid'});}if(['FAILED','EXPIRED','ABANDONED','REJECTED','VOIDED','REVERSED','REFUNDED'].includes(status)){await db.runTransaction(async tx=>{const fresh=await tx.get(ref);if(!fresh.exists||fresh.data().paymentStatus!=='pending'||fresh.data().stockRestored)return;const o=fresh.data();await restoreOrderInventoryTx(tx,o);tx.update(ref,{paymentStatus:'failed',status:'ملغي',stockRestored:true,kashierPaymentStatus:status,updatedAt:admin.firestore.FieldValue.serverTimestamp()});});return res.json({ok:true,paymentStatus:'failed'});}res.json({ok:true,paymentStatus:'pending',kashierStatus:status});}catch(e){console.error('Kashier status error',e);res.json({ok:true,paymentStatus:'pending'});}
});

app.post("/api/kashier/webhook", async (req,res)=>{
  const data=req.body?.data||{};const received=String(req.headers['x-kashier-signature']||'');if(!verifyKashierWebhook(data,received))return res.status(401).end();res.status(200).end();
  try{const merchantOrderId=String(data.merchantOrderId||data.orderReference||'').trim();if(!merchantOrderId)return;const snap=await db.collection('orders').where('orderCode','==',merchantOrderId).limit(1).get();if(snap.empty)return;const ref=snap.docs[0].ref;const status=String(data.status||'').toUpperCase();let changed=false;await db.runTransaction(async tx=>{const fresh=await tx.get(ref);if(!fresh.exists)return;const order=fresh.data();if(status==='SUCCESS'&&order.paymentStatus!=='paid'){tx.update(ref,{paymentStatus:'paid',status:order.status==='ملغي'?'جديد':order.status,kashierTransactionId:data.transactionId||null,kashierPaymentStatus:status,updatedAt:admin.firestore.FieldValue.serverTimestamp()});changed=true;}else if(status==='FAILURE'&&order.paymentStatus!=='failed'&&!order.stockRestored){await restoreOrderInventoryTx(tx,order);tx.update(ref,{paymentStatus:'failed',status:'ملغي',stockRestored:true,kashierTransactionId:data.transactionId||null,kashierPaymentStatus:status,updatedAt:admin.firestore.FieldValue.serverTimestamp()});changed=true;}});if(changed){const fresh=await ref.get();await notifyTelegram({...fresh.data(),id:ref.id});}}catch(e){console.error('Kashier webhook processing error',e.message);}
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
        ...(Array.isArray(order.items)&&order.items.length?order.items.map(it=>({name:it.productName||"منتج AXEL",amount:Math.round(Number(it.unitPrice||0)*100),quantity:Number(it.quantity||1),description:`AXEL ${it.color||""} ${it.size||""}`})):[{name:order.productName||"منتج AXEL",amount:Math.round(Number(order.unitPrice||0)*100),quantity:Number(order.quantity||1),description:"AXEL T-shirt"}]),
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
  res.json({ ok: true, order: { id: snap.docs[0].id, orderCode: d.orderCode, paymentStatus: d.paymentStatus, status: d.status, total: d.total } });
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
    const [productsSnap, ordersSnap, analyticsSnap, couponsSnap] = await Promise.all([db.collection("products").get(), db.collection("orders").get(), db.collection("analytics").get(), db.collection("coupons").get()]);
    const products=productsSnap.docs.map(d=>d.data()), orders=ordersSnap.docs.map(d=>d.data()), coupons=couponsSnap.docs.map(d=>d.data());
    let sales=0,paid=0,paidOrders=0,pending=0,cancelled=0,refunded=0,visits=0,stockPieces=0,todayOrders=0,todaySales=0; const today=new Date(); today.setHours(0,0,0,0);
    for(const p of products){for(const colors of Object.values(p.stock||{}))for(const q of Object.values(colors||{}))stockPieces+=Number(q||0);}
    for(const o of orders){const total=Number(o.total||0);sales+=total;if(o.paymentStatus==='paid'){paid+=total;paidOrders++;}if(o.paymentStatus==='pending')pending++;if(o.status==='ملغي')cancelled++;if(o.paymentStatus==='refunded'||o.status==='مرتجع')refunded++;const created=o.createdAt?.seconds?o.createdAt.seconds*1000:0;if(created>=today.getTime()){todayOrders++;todaySales+=total;}}
    analyticsSnap.forEach(doc=>visits+=Number(doc.data().visits||0));
    const activeProducts=products.filter(p=>p.active!==false).length; const outOfStock=products.filter(p=>Object.values(p.stock||{}).every(c=>Object.values(c||{}).every(q=>Number(q||0)<=0))).length; const couponUses=coupons.reduce((a,c)=>a+Number(c.usedCount||0),0); const avgOrder=orders.length?sales/orders.length:0;
    res.json({ok:true,stats:{products:productsSnap.size,activeProducts,orders:orders.length,paidOrders,sales,paidSales:paid,pendingOrders:pending,cancelledOrders:cancelled,refundedOrders:refunded,visits,stockPieces,outOfStock,todayOrders,todaySales,avgOrder,coupons:coupons.length,couponUses}});
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
          if (order.couponCode) { const couponRef=db.collection("coupons").doc(String(order.couponCode).toUpperCase()); const couponSnap=await tx.get(couponRef); if(couponSnap.exists) tx.update(couponRef,{usedCount:admin.firestore.FieldValue.increment(-1),updatedAt:admin.firestore.FieldValue.serverTimestamp()}); }
          const restoreItems=Array.isArray(order.items)&&order.items.length?order.items:[{productId:order.productId,color:order.color,size:order.size,quantity:order.quantity}];
          for(const it of restoreItems){const productRef=db.collection("products").doc(it.productId);const productSnap=await tx.get(productRef);if(productSnap.exists){const product=productSnap.data();const stock=structuredClone(product.stock||{});stock[it.color]=stock[it.color]||{};stock[it.color][it.size]=Number(stock[it.color][it.size]||0)+Number(it.quantity||0);tx.update(productRef,{stock,updatedAt:admin.firestore.FieldValue.serverTimestamp()});}}
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


app.post("/api/paypal/create", async (req,res)=>{if(!requireFirebase(res))return;if(!paypalConfigured())return res.status(503).json({ok:false,error:"PayPal غير مُفعّل. أضف PAYPAL_CLIENT_ID وPAYPAL_CLIENT_SECRET."});const orderId=String(req.body?.orderId||'').trim();try{const ref=db.collection('orders').doc(orderId),snap=await ref.get();if(!snap.exists)return res.status(404).json({ok:false,error:'الطلب غير موجود'});const order=snap.data();if(order.paymentMethod!=='PayPal')return res.status(400).json({ok:false,error:'طريقة الدفع لهذا الطلب ليست PayPal'});const token=await paypalAccessToken();const r=await fetch(`${paypalBaseUrl()}/v2/checkout/orders`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:order.orderCode,custom_id:order.orderCode,amount:{currency_code:'EGP',value:Number(order.total||0).toFixed(2)}}],application_context:{brand_name:'AXEL',user_action:'PAY_NOW',return_url:`${appBaseUrl(req)}/checkout.html?payment=paypal&order=${encodeURIComponent(order.orderCode)}`,cancel_url:`${appBaseUrl(req)}/checkout.html?payment=paypal_cancel&order=${encodeURIComponent(order.orderCode)}`}})});const d=await r.json().catch(()=>({}));const approve=d.links?.find(x=>x.rel==='approve')?.href;if(!r.ok||!approve)return res.status(502).json({ok:false,error:'تعذر إنشاء عملية PayPal'});await ref.update({paypalOrderId:d.id,paymentStatus:'pending',updatedAt:admin.firestore.FieldValue.serverTimestamp()});res.json({ok:true,checkoutUrl:approve});}catch(e){console.error('PayPal create',e);res.status(502).json({ok:false,error:'تعذر الاتصال بPayPal حالياً'});}});
app.post("/api/paypal/capture", async(req,res)=>{if(!requireFirebase(res))return;if(!paypalConfigured())return res.status(503).json({ok:false,error:'PayPal غير مُعد'});const orderId=String(req.body?.orderId||'').trim(),orderCode=String(req.body?.orderCode||'').trim();try{const snap=orderId?await db.collection('orders').doc(orderId).get().then(x=>({empty:!x.exists,docs:x.exists?[x]:[]})):await db.collection('orders').where('orderCode','==',orderCode).limit(1).get();if(snap.empty)return res.status(404).json({ok:false,error:'الطلب غير موجود'});const ref=snap.docs[0].ref,order=snap.docs[0].data();if(!order.paypalOrderId)return res.status(400).json({ok:false,error:'عملية PayPal غير موجودة'});if(order.paymentStatus==='paid')return res.json({ok:true,paymentStatus:'paid'});const token=await paypalAccessToken();const r=await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(order.paypalOrderId)}/capture`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});const d=await r.json().catch(()=>({}));const paid=d.status==='COMPLETED'||d.purchase_units?.[0]?.payments?.captures?.some(x=>x.status==='COMPLETED');if(paid){await ref.update({paymentStatus:'paid',status:order.status==='ملغي'?'جديد':order.status,paypalCaptureId:d.purchase_units?.[0]?.payments?.captures?.[0]?.id||null,updatedAt:admin.firestore.FieldValue.serverTimestamp()});const fresh=await ref.get();await notifyTelegram({...fresh.data(),id:ref.id});return res.json({ok:true,paymentStatus:'paid'});}await db.runTransaction(async tx=>{const fresh=await tx.get(ref);if(!fresh.exists||fresh.data().stockRestored)return;await restoreOrderInventoryTx(tx,fresh.data());tx.update(ref,{paymentStatus:'failed',status:'ملغي',stockRestored:true,updatedAt:admin.firestore.FieldValue.serverTimestamp()});});res.json({ok:true,paymentStatus:'failed'});}catch(e){console.error('PayPal capture',e);res.status(502).json({ok:false,error:'تعذر تأكيد الدفع عبر PayPal'});}});

app.use(express.static(__dirname, { index: "index.html", extensions: ["html"], setHeaders(res){ res.setHeader("Cache-Control", "no-cache, must-revalidate"); } }));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "API endpoint غير موجود" });
  res.sendFile(path.join(__dirname, "index.html"));
});

// Vercel imports the Express app as a serverless function.
// Keep local development working with `npm start`.
if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AXEL final backend running on port ${PORT}`);
    console.log(`ImageKit: ${isImageKitConfigured() ? "configured" : "missing config"}`);
    console.log(`Firebase Admin: ${firebaseReady ? "configured" : "missing config"}`);
  });
}

export default app;
