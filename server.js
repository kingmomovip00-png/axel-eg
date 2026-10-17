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


function splitCustomerName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || "AXEL", lastName: parts.join(" ") || "Customer" };
}

async function notifyTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{productName:order.productName,color:order.color,size:order.size,quantity:order.quantity}];
  const itemText = items.map((it,i)=>`${i+1}) ${it.productName||"منتج AXEL"} — ${it.color||""} — ${it.size||""} × ${Number(it.quantity||1)}`).join("\n");
  const text = ["🛍️ طلب جديد - AXEL",`رقم الطلب: ${order.orderCode}`,`العميل: ${order.customerName}`,`الهاتف: ${order.phone}`,`المنتجات:\n${itemText}`,`الإجمالي: ${order.total} جنيه`,`الخصم: ${order.discount||0} جنيه`,order.couponCode?`الكوبون: ${order.couponCode}`:"",`طريقة الدفع: ${order.paymentMethod}`,`حالة الدفع: ${order.paymentStatus}`,order.inventoryStatus === "needs_review" ? "⚠️ تنبيه: الدفع تم لكن المخزون يحتاج مراجعة يدوية" : "",`العنوان: ${order.address}`].filter(Boolean).join("\n");
  try { const imageUrl=String(order.imageUrl||items[0]?.imageUrl||"").trim(); const endpoint=imageUrl?"sendPhoto":"sendMessage"; const body=imageUrl?{chat_id:chatId,photo:imageUrl,caption:text}:{chat_id:chatId,text}; await fetch(`https://api.telegram.org/bot${token}/${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); } catch(error){ console.error("Telegram notification failed:",error.message); }
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

app.get("/api/banners/:id", async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const snap = await db.collection("banners").doc(req.params.id).get();
    if (!snap.exists || snap.data().active === false) return res.status(404).json({ ok: false, error: "البانر غير موجود" });
    res.json({ ok: true, banner: serializeDoc(snap) });
  } catch { res.status(500).json({ ok: false, error: "فشل تحميل البانر" }); }
});

// ---------- KASHIER PAYMENT METHODS ----------
app.get("/api/kashier/payment-methods", async (req, res) => {
  const secretKey = env("KASHIER_SECRET_KEY"), apiKey = env("KASHIER_API_KEY"), merchantId = env("KASHIER_MERCHANT_ID");
  if (!secretKey || !apiKey || !merchantId) return res.json({ ok: true, configured: false, methods: [] });
  const base = env("KASHIER_API_BASE_URL", "https://api.kashier.io").replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/v2/merchants/${encodeURIComponent(merchantId)}/paymentMethods`, { headers: { Authorization: secretKey, "api-key": apiKey, Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, error: data?.message || "تعذر قراءة طرق الدفع من Kashier" });
    const methods = [];
    if (data.card !== false) methods.push({ id: "card", title: "فيزا / ماستركارد / ميزة", subtitle: "دفع آمن بالبطاقات عبر Kashier", icon: "assets/icons/visa.svg" });
    if (data.wallet !== false) methods.push({ id: "wallet", title: "فودافون كاش والمحافظ الإلكترونية", subtitle: "اختيار المحفظة ورقم الهاتف يتم داخل Kashier", icon: "assets/icons/vodafone-cash.svg" });
    methods.push({ id: "applepay", title: "Apple Pay", subtitle: "يحتاج جهازًا ومتصفحًا داعمين وتفعيل نطاق المتجر لدى Kashier", icon: "assets/icons/apple-pay.svg" });
    methods.push({ id: "instapay", title: "InstaPay", subtitle: "الدفع عبر QR من خلال خدمة InstaPay لدى Kashier", icon: "assets/icons/instapay.svg" });
    res.json({ ok: true, configured: true, methods });
  } catch { res.status(502).json({ ok: false, error: "تعذر الاتصال بـ Kashier" }); }
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
  const b = req.body || {};
  const mediaUrl = String(b.mediaUrl || b.videoUrl || b.imageUrl || "").trim();
  const mediaType = b.mediaType === "video" || b.videoUrl ? "video" : "image";
  if (!mediaUrl) return res.status(400).json({ ok: false, error: "ارفع الفيديو أولاً" });
  const price = Number(b.offerPrice || 0);
  if (b.productId && price <= 0) return res.status(400).json({ ok: false, error: "أدخل سعر العرض للمنتج المرتبط بالفيديو" });
  if (b.productId) { const p = await db.collection("products").doc(String(b.productId)).get(); if (!p.exists) return res.status(400).json({ ok: false, error: "المنتج المرتبط بالفيديو غير موجود" }); }
  const ref = await db.collection("banners").add({ imageUrl: mediaType === "image" ? mediaUrl : "", mediaUrl, videoUrl: mediaType === "video" ? mediaUrl : "", mediaType, fileId: b.fileId || "", productId: b.productId || "", offerPrice: price, offerColor: String(b.offerColor || ""), active: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
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
  const productId = String(req.query.productId || "").trim();
  const productIds = String(req.query.productIds || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (!code) return res.status(400).json({ ok: false, error: "اكتب كود الخصم" });
  try {
    const snap = await db.collection("coupons").doc(code).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "كود الخصم غير صحيح" });
    const c = snap.data(); const now = Date.now();
    if (c.active === false || (c.expiresAt && new Date(c.expiresAt.toDate ? c.expiresAt.toDate() : c.expiresAt).getTime() < now) || (Number(c.usageLimit || 0) > 0 && Number(c.usedCount || 0) >= Number(c.usageLimit))) return res.status(400).json({ ok: false, error: "كود الخصم غير متاح حالياً" });
    if (subtotal < Number(c.minOrder || 0)) return res.status(400).json({ ok: false, error: `الحد الأدنى للطلب لاستخدام الكود هو ${Number(c.minOrder || 0)} ج` });
    if (quantity < Number(c.minQuantity || 1)) return res.status(400).json({ ok: false, error: `يجب شراء ${Number(c.minQuantity || 1)} قطع على الأقل لاستخدام الكود` });
    if (Array.isArray(c.productIds) && c.productIds.length && !c.productIds.some(x=>productIds.includes(x)||x===productId)) return res.status(400).json({ok:false,error:"هذا الكوبون غير متاح لهذا المنتج"});
    let discount = c.type === "fixed" ? Math.min(subtotal, Number(c.value || 0)) : subtotal * Math.min(100, Number(c.value || 0)) / 100;
    if (Number(c.maxDiscount || 0) > 0) discount = Math.min(discount, Number(c.maxDiscount));
    discount = Math.max(0, Math.round(discount * 100) / 100);
    res.json({ ok: true, coupon: { code, type: c.type, value: Number(c.value || 0), discount, minOrder: Number(c.minOrder || 0), minQuantity:Number(c.minQuantity||1), maxDiscount: Number(c.maxDiscount || 0) } });
  } catch { res.status(500).json({ ok: false, error: "تعذر التحقق من الكود" }); }
});

app.get("/api/coupons/featured", async (req,res)=>{
  if(!requireFirebase(res))return;
  try{const snap=await db.collection("coupons").where("active","==",true).where("showOnHome","==",true).limit(10).get(); const now=Date.now(); const list=snap.docs.map(serializeDoc).filter(c=>!(c.expiresAt&&new Date(c.expiresAt?.seconds?c.expiresAt.seconds*1000:c.expiresAt).getTime()<now)&&(!Number(c.usageLimit||0)||Number(c.usedCount||0)<Number(c.usageLimit||0))); const c=list[0]; if(!c)return res.json({ok:true,coupon:null}); res.json({ok:true,coupon:{code:c.code,type:c.type,value:Number(c.value||0),minOrder:Number(c.minOrder||0),minQuantity:Number(c.minQuantity||1),usageLimit:Number(c.usageLimit||0),usedCount:Number(c.usedCount||0),title:c.promoTitle||"خصم خاص",text:c.promoText||"استخدم الكود عند الطلب"}}); }catch{res.status(500).json({ok:false,error:"تعذر تحميل العرض"});}
});

// ---------- QR LANDING: one unique single-use coupon per visitor ----------
const QR_DEFAULTS = { enabled: true, percent: 20, expiryDays: 30 };
async function getQrSettings(){ try{ const d=await db.collection("settings").doc("qr").get(); return {...QR_DEFAULTS, ...(d.exists?d.data():{})}; }catch{ return {...QR_DEFAULTS}; } }
app.post("/api/coupons/qr", async (req,res)=>{
  try{
    const st=await getQrSettings();
    if(!st.enabled)return res.json({ok:true,coupon:null,reason:"off"});
    // The phone number comes from a Firebase-verified SMS login, never from user input.
    let phone="";
    try{
      const decoded=await admin.auth().verifyIdToken(String((req.body||{}).idToken||""));
      const raw=String(decoded.phone_number||"").replace(/\D/g,"");
      if(raw.startsWith("20")&&raw.length===12)phone="0"+raw.slice(2);
    }catch{}
    if(!/^01[0125]\d{8}$/.test(phone))return res.status(401).json({ok:false,error:"لازم تأكد رقم موبايلك بكود الـ SMS الأول."});
    const sha=x=>crypto.createHash("sha256").update(x).digest("hex").slice(0,32);
    const phoneRef=db.collection("qrPhones").doc(phone), now=Date.now();
    // 1) Same number always gets the same code.
    const ph=await phoneRef.get();
    if(ph.exists){
      const cs=await db.collection("coupons").doc(String(ph.data().code)).get(), c=cs.exists?cs.data():null;
      const exp=c&&c.expiresAt?new Date(c.expiresAt.toDate?c.expiresAt.toDate():c.expiresAt).getTime():0;
      if(!c||c.active===false||(Number(c.usageLimit||0)>0&&Number(c.usedCount||0)>=Number(c.usageLimit))||(exp&&exp<now))return res.json({ok:true,coupon:null,reason:"used"});
      return res.json({ok:true,coupon:{code:c.code,value:Number(c.value||0),expiresAt:exp?new Date(exp).toISOString():null}});
    }
    // 2) Safety net against farming fake numbers from one connection.
    const ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"").split(",")[0].trim();
    const ipRef=db.collection("qrClaims").doc(sha(ip+"|axel-qr")), ipSnap=await ipRef.get();
    let count=0,start=now;
    if(ipSnap.exists){const c=ipSnap.data(); if(now-Number(c.start||0)<86400000){count=Number(c.count||0);start=Number(c.start);}}
    if(count>=5)return res.status(429).json({ok:false,error:"وصلت للحد الأقصى اليوم، جرّب بكرة."});
    // 3) Create the unique single-use coupon and bind it to the number atomically.
    const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const percent=Math.min(90,Math.max(1,Number(st.percent||20))), days=Math.max(0,Number(st.expiryDays||0));
    const expiresAt=days?new Date(now+days*86400000):null;
    let code="";
    for(let i=0;i<5;i++){
      code="AXEL-"+Array.from({length:6},()=>alphabet[crypto.randomInt(alphabet.length)]).join("");
      if(!(await db.collection("coupons").doc(code).get()).exists)break; code="";
    }
    if(!code)throw new Error("code collision");
    const ts=admin.firestore.FieldValue.serverTimestamp();
    const out=await db.runTransaction(async tx=>{
      if((await tx.get(phoneRef)).exists)return {race:true};
      tx.set(db.collection("coupons").doc(code),{code,type:"percent",value:percent,minOrder:0,minQuantity:1,maxDiscount:0,usageLimit:1,usedCount:0,showOnHome:false,productIds:[],promoTitle:`خصم ${percent}% على أول أوردر`,promoText:"كود خاص من صفحة الـ QR، يُستخدم مرة واحدة",expiresAt,active:true,source:"qr",phone,createdAt:ts,updatedAt:ts});
      tx.set(phoneRef,{code,createdAt:ts});
      return {race:false};
    });
    if(out.race)return res.json({ok:true,coupon:null,reason:"used"});
    await ipRef.set({count:count+1,start});
    res.json({ok:true,coupon:{code,value:percent,expiresAt:expiresAt?expiresAt.toISOString():null}});
  }catch(e){console.error(e);res.status(500).json({ok:false,error:"تعذر إنشاء الكود، حاول تاني."});}
});
app.get("/api/admin/qr-settings", requireAdmin, async (req,res)=>res.json({ok:true,settings:await getQrSettings()}));
app.put("/api/admin/qr-settings", requireAdmin, async (req,res)=>{
  const b=req.body||{}, percent=Math.min(90,Math.max(1,Number(b.percent||20))), expiryDays=Math.min(365,Math.max(0,Number(b.expiryDays||0)));
  await db.collection("settings").doc("qr").set({enabled:b.enabled!==false,percent,expiryDays,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  res.json({ok:true});
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
app.patch("/api/admin/coupons/:id", requireAdmin, async (req,res)=>{ const patch={},b=req.body||{}; for(const k of ['type','value','minOrder','minQuantity','maxDiscount','usageLimit','active','showOnHome']) if(k in b) patch[k]=k==='type'?(b[k]==='fixed'?'fixed':'percent'):['active','showOnHome'].includes(k)?Boolean(b[k]):Number(b[k]||0); if('productIds' in b)patch.productIds=Array.isArray(b.productIds)?b.productIds.map(String).filter(Boolean):[]; if('expiresAt' in b)patch.expiresAt=b.expiresAt?new Date(b.expiresAt):null; if('promoTitle' in b)patch.promoTitle=String(b.promoTitle||""); if('promoText' in b)patch.promoText=String(b.promoText||""); patch.updatedAt=admin.firestore.FieldValue.serverTimestamp(); await db.collection('coupons').doc(String(req.params.id).toUpperCase()).update(patch); res.json({ok:true}); });
app.delete("/api/admin/coupons/:id", requireAdmin, async (req,res)=>{ await db.collection('coupons').doc(String(req.params.id).toUpperCase()).delete(); res.json({ok:true}); });

// ---------- ORDERS ----------
app.post("/api/orders", async (req, res) => {
  if (!requireFirebase(res)) return;
  const body = req.body || {};
  const items = Array.isArray(body.items) && body.items.length
    ? body.items.map(x => ({
        productId: String(x.productId || ""), color: String(x.color || ""),
        size: String(x.size || ""), quantity: Math.max(1, Math.min(20, Number(x.quantity) || 1)),
        bannerId: String(x.bannerId || "")
      })).filter(x => x.productId && x.color && x.size)
    : [{ productId: String(body.productId || ""), color: String(body.color || ""),
         size: String(body.size || ""), quantity: Math.max(1, Math.min(20, Number(body.quantity) || 1)),
         bannerId: String(body.bannerId || "") }].filter(x => x.productId && x.color && x.size);
  const { customerName, phone, email, address, paymentMethod = "", couponCode = "" } = body;
  const onlineMethods = ["card", "wallet", "applepay", "instapay"];
  if (!items.length || !customerName || !phone || !email || !address)
    return res.status(400).json({ ok: false, error: "أكمل بيانات العميل والمنتجات" });
  if (!onlineMethods.includes(String(paymentMethod)))
    return res.status(400).json({ ok: false, error: "اختر طريقة دفع متاحة عبر Kashier" });

  try {
    const orderCode = makeOrderCode();
    const orderRef = db.collection("orders").doc();
    let orderData;
    await db.runTransaction(async tx => {
      const productRefs = [...new Map(items.map(i => [i.productId, db.collection("products").doc(i.productId)])).values()];
      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));
      const productById = new Map(productRefs.map((ref, i) => [ref.id, productSnaps[i]]));
      const bannerIds = [...new Set(items.map(i => i.bannerId).filter(Boolean))];
      const bannerRefs = bannerIds.map(id => db.collection("banners").doc(id));
      const bannerSnaps = [];
      for (const ref of bannerRefs) bannerSnaps.push(await tx.get(ref));
      const bannerById = new Map(bannerRefs.map((ref, i) => [ref.id, bannerSnaps[i]]));
      const code = String(couponCode || "").trim().toUpperCase();
      const couponRef = code ? db.collection("coupons").doc(code) : null;
      const couponSnap = couponRef ? await tx.get(couponRef) : null;

      // Validate total requested quantity per variant, including duplicate cart lines.
      const demand = new Map();
      for (const it of items) {
        const key = `${it.productId}::${it.color}::${it.size}`;
        demand.set(key, (demand.get(key) || 0) + it.quantity);
      }
      for (const [key, qty] of demand) {
        const [productId, color, size] = key.split("::");
        const snap = productById.get(productId);
        if (!snap?.exists) throw new Error("PRODUCT_NOT_FOUND");
        const product = snap.data();
        if (product.active === false) throw new Error("PRODUCT_INACTIVE");
        const available = Number(product.stock?.[color]?.[size] || 0);
        if (available < qty) throw new Error("OUT_OF_STOCK");
      }

      const prepared = [];
      let subtotal = 0;
      for (const it of items) {
        const product = productById.get(it.productId).data();
        let unitPrice = Number(product.salePrice || 0), offerApplied = false;
        if (it.bannerId) {
          const bs = bannerById.get(it.bannerId);
          const banner = bs?.exists ? bs.data() : null;
          if (!banner || banner.active === false || String(banner.productId || "") !== it.productId || Number(banner.offerPrice || 0) <= 0)
            throw new Error("INVALID_BANNER_OFFER");
          unitPrice = Number(banner.offerPrice);
          offerApplied = true;
        }
        subtotal += unitPrice * it.quantity;
        prepared.push({
          productId: it.productId, productName: product.name || "منتج AXEL",
          imageUrl: product.images?.find(x => x.color === it.color)?.url || product.images?.[0]?.url || "",
          color: it.color, size: it.size, quantity: it.quantity, unitPrice, offerApplied, bannerId: it.bannerId
        });
      }

      const shipping = Number(process.env.SHIPPING_PRICE || 50);
      let discount = 0, appliedCoupon = "";
      if (couponRef) {
        if (!couponSnap?.exists) throw new Error("COUPON_INVALID");
        const c = couponSnap.data(), now = Date.now();
        const totalQty = prepared.reduce((a, x) => a + x.quantity, 0);
        if (c.active === false || (c.expiresAt && new Date(c.expiresAt.toDate ? c.expiresAt.toDate() : c.expiresAt).getTime() < now) || (Number(c.usageLimit || 0) > 0 && Number(c.usedCount || 0) >= Number(c.usageLimit))) throw new Error("COUPON_INVALID");
        if (subtotal < Number(c.minOrder || 0)) throw new Error("COUPON_MIN_ORDER");
        if (totalQty < Number(c.minQuantity || 1)) throw new Error("COUPON_MIN_QTY");
        if (Array.isArray(c.productIds) && c.productIds.length && !prepared.some(x => c.productIds.includes(x.productId))) throw new Error("COUPON_PRODUCT");
        discount = c.type === "fixed" ? Math.min(subtotal, Number(c.value || 0)) : subtotal * Math.min(100, Number(c.value || 0)) / 100;
        if (Number(c.maxDiscount || 0) > 0) discount = Math.min(discount, Number(c.maxDiscount));
        discount = Math.max(0, Math.round(discount * 100) / 100);
        appliedCoupon = code;
      }
      const total = Math.max(0, subtotal - discount + shipping);
      const first = prepared[0];
      orderData = {
        orderCode, items: prepared, productId: first.productId, productName: first.productName,
        imageUrl: first.imageUrl, color: first.color, size: first.size, quantity: first.quantity,
        unitPrice: first.unitPrice, offerApplied: first.offerApplied, bannerId: first.bannerId,
        couponCode: appliedCoupon, discount, customerName: String(customerName).trim(),
        phone: String(phone).trim(), email: String(email).trim().toLowerCase(), address: String(address).trim(),
        paymentMethod, paymentStatus: "pending", status: "جديد", subtotal, shipping, total,
        inventoryDeducted: false, couponUsageRecorded: false, inventoryStatus: "pending_payment",
        createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      // Critical: don't deduct stock, consume a coupon, or notify Telegram until Kashier confirms payment.
      tx.set(orderRef, orderData);
    });
    return res.status(201).json({ ok: true, orderId: orderRef.id, orderCode, total: orderData.total, paymentStatus: "pending" });
  } catch (error) {
    const map = {
      PRODUCT_NOT_FOUND: "المنتج غير موجود", PRODUCT_INACTIVE: "هناك منتج غير متاح حالياً",
      OUT_OF_STOCK: "إحدى الكميات المطلوبة غير متاحة", INVALID_BANNER_OFFER: "العرض المرتبط بالبانر غير صالح",
      COUPON_INVALID: "كود الخصم غير صالح أو منتهي أو استنفد عدد استخداماته",
      COUPON_MIN_ORDER: "الحد الأدنى للطلب لاستخدام الكود لم يتحقق",
      COUPON_MIN_QTY: "يجب شراء عدد القطع المطلوب للكوبون", COUPON_PRODUCT: "كود الخصم غير متاح للمنتجات المختارة"
    };
    console.error("Create order error:", error.message);
    return res.status(400).json({ ok: false, error: map[error.message] || "فشل إنشاء الطلب" });
  }
});

app.post("/api/kashier/checkout", async (req, res) => {
  const secretKey = env("KASHIER_SECRET_KEY"), apiKey = env("KASHIER_API_KEY"), merchantId = env("KASHIER_MERCHANT_ID");
  if (!secretKey || !apiKey || !merchantId) return res.status(503).json({ ok:false, error:"بوابة Kashier لم تُفعّل بعد. أضف KASHIER_SECRET_KEY وKASHIER_API_KEY وKASHIER_MERCHANT_ID في Vercel." });
  const orderId = String(req.body?.orderId||"").trim(), method = String(req.body?.method||"").trim();
  if (!orderId || !["card","wallet","applepay","instapay"].includes(method)) return res.status(400).json({ok:false,error:"بيانات الدفع غير مكتملة"});
  if (!requireFirebase(res)) return;
  try {
    const ref=db.collection("orders").doc(orderId), snap=await ref.get(); if(!snap.exists)return res.status(404).json({ok:false,error:"الطلب غير موجود"});
    const order=snap.data();
    if(order.paymentStatus==='paid')return res.status(400).json({ok:false,error:"الطلب مدفوع بالفعل"});
    const configuredAppUrl = env("APP_URL");
    let appUrl;
    try {
      if (!configuredAppUrl) throw new Error("APP_URL is missing");
      const parsedAppUrl = new URL(configuredAppUrl);
      if (parsedAppUrl.protocol !== "https:" || parsedAppUrl.username || parsedAppUrl.password || parsedAppUrl.search || parsedAppUrl.hash)
        throw new Error("APP_URL must be a clean HTTPS site URL");
      appUrl = parsedAppUrl.origin;
    } catch {
      return res.status(503).json({ ok: false, error: "APP_URL غير صالح. ضع رابط موقع AXEL الحقيقي كاملًا ويبدأ بـ https:// داخل Vercel." });
    }
    const apiBase=env("KASHIER_API_BASE_URL","https://api.kashier.io").replace(/\/$/,"");
    if (method === "instapay") {
      const fepBase=env("KASHIER_FEP_BASE_URL", apiBase.includes("test-api") ? "https://test-fep.kashier.io" : "https://fep.kashier.io").replace(/\/$/,"");
      const amount=Number(order.total||0).toFixed(2);
      const hashPath=`/?payment=${merchantId}.${order.orderCode}.${Number(amount)}.EGP`;
      const hash=crypto.createHmac("sha256",apiKey).update(hashPath).digest("hex");
      const payload={apiOperation:"GENERATE_QR",interactionSource:"ECOMMERCE",order:{reference:order.orderCode,amount:Number(amount),currency:"EGP"},paymentMethod:{type:"instapay",instapay:{validity:env("KASHIER_INSTAPAY_VALIDITY","30")}},merchantId,serverWebhook:`${appUrl}/api/kashier/webhook`};
      const r=await fetch(`${fepBase}/v3/orders`,{method:"POST",headers:{"Content-Type":"application/json","Kashier-Hash":hash},body:JSON.stringify(payload)});
      const data=await r.json().catch(()=>({}));
      if(!r.ok || String(data.status||data.data?.status||"").toUpperCase()==="FAILURE") { console.error("Kashier InstaPay error",r.status,data); return res.status(502).json({ok:false,error:data.message||data.data?.message||"تعذر إنشاء طلب InstaPay. تأكد من تفعيل الخدمة لدى Kashier."}); }
      const body=data.data||data;
      const instapay=body.paymentMethod?.instapay||body.payment_method?.instapay||body.instapay||{};
      const qrCode=instapay.qrCode||instapay.qrImage||instapay.qrCodeUrl||instapay.qrUrl||body.qrCode||body.qrImage||body.qrCodeUrl||body.qrUrl||null;
      const qrPayload=instapay.qrPayload||instapay.qrString||instapay.qrData||instapay.payload||body.qrPayload||body.qrString||body.qrData||body.payload||null;
      await ref.update({kashierMethod:method,kashierOrderReference:order.orderCode,kashierStatus:"PENDING",paymentStatus:"pending",updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      return res.json({ok:true,kind:"instapay",orderCode:order.orderCode,qrCode,qrPayload,expiresAt:instapay.expiresAt||body.expiresAt||null,message:"افتح تطبيق InstaPay وامسح رمز QR ثم انتظر تأكيد Kashier."});
    }
    const allowedMethods = method === "wallet" ? "wallet" : "card";
    const expireAt=new Date(Date.now()+30*60*1000).toISOString();
    const redirectUrl = new URL("/checkout.html", appUrl);
    redirectUrl.searchParams.set("payment", "return");
    redirectUrl.searchParams.set("order", order.orderCode);
    const payload={expireAt,maxFailureAttempts:3,paymentType:"credit",amount:Number(order.total||0).toFixed(2),currency:"EGP",order:order.orderCode,merchantId,merchantRedirect:redirectUrl.toString(),display:"ar",type:"one-time",allowedMethods,redirectMethod:null,metaData:{orderId,orderCode:order.orderCode},failureRedirect:false,description:`AXEL Order ${order.orderCode}`,interactionSource:"ECOMMERCE",enable3DS:method!=="applepay",serverWebhook:`${appUrl}/api/kashier/webhook`,customer:{email:order.email,reference:order.orderCode}};
    const r=await fetch(`${apiBase}/v3/payment/sessions`,{method:"POST",headers:{Authorization:secretKey,"api-key":apiKey,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.sessionUrl){console.error("Kashier session error",r.status,data);return res.status(502).json({ok:false,error:data?.message||"تعذر إنشاء جلسة الدفع من Kashier"});}
    const sessionId=data._id||data.sessionId||data.id||null;
    await ref.update({kashierSessionId:sessionId,kashierMethod:method,paymentStatus:"pending",updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    if(method==="applepay") return res.json({ok:true,kind:"applepay",sessionId,mode:apiBase.includes("test-api")?"test":"live",orderCode:order.orderCode});
    res.json({ok:true,kind:"redirect",checkoutUrl:data.sessionUrl,sessionId});
  } catch(e){console.error("Kashier checkout error",e.message);res.status(502).json({ok:false,error:"تعذر الاتصال بـ Kashier حالياً"});}
});

app.post("/api/kashier/webhook", async (req, res) => {
  if (!firebaseReady || !db) return res.sendStatus(503);
  try {
    const data = req.body?.data || {};
    const sig = String(req.get("x-kashier-signature") || "");
    const key = env("KASHIER_API_KEY");
    if (!key || !sig) return res.sendStatus(401);
    const keys = Array.isArray(data.signatureKeys) ? [...data.signatureKeys].sort() : [];
    if (!keys.length) return res.sendStatus(401);
    const signedPayload = keys.map(k => `${k}=${encodeURIComponent(String(data[k] ?? ""))}`).join("&");
    const expected = crypto.createHmac("sha256", key).update(signedPayload).digest("hex");
    const a = Buffer.from(expected.toLowerCase());
    const b = Buffer.from(sig.toLowerCase());
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);

    const code = String(data.merchantOrderId || data.orderReference || data.order || "").trim();
    if (!code) return res.sendStatus(200);
    const found = await db.collection("orders").where("orderCode", "==", code).limit(1).get();
    if (found.empty) return res.sendStatus(200);
    const orderRef = found.docs[0].ref;
    const status = String(data.status || "").toUpperCase();
    const initialOrder = found.docs[0].data();
    const paidAmount = Number(data.amount);
    const expectedAmount = Number(initialOrder.total || 0);
    if (status === "SUCCESS" && (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.009)) {
      console.error("Kashier webhook amount mismatch", { orderCode: code, paidAmount, expectedAmount });
      return res.sendStatus(200);
    }
    if (status === "SUCCESS" && data.currency && String(data.currency).toUpperCase() !== "EGP") {
      console.error("Kashier webhook currency mismatch", { orderCode: code, currency: data.currency });
      return res.sendStatus(200);
    }

    let notificationOrder = null;
    await db.runTransaction(async tx => {
      notificationOrder = null; // Reset on Firestore transaction retries.
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return;
      const order = orderSnap.data();
      if (order.paymentStatus === "paid") return; // Idempotent: duplicate webhook must not deduct twice.

      if (status !== "SUCCESS") {
        if (["FAILURE", "REJECTED", "VOIDED", "REVERSED"].includes(status)) {
          tx.update(orderRef, {
            paymentStatus: "failed", status: "ملغي", inventoryStatus: "not_deducted",
            kashierTransactionId: data.transactionId || null, kashierStatus: status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        return;
      }

      const items = Array.isArray(order.items) ? order.items : [];
      const demand = new Map();
      for (const item of items) {
        const key = `${item.productId}::${item.color}::${item.size}`;
        demand.set(key, (demand.get(key) || 0) + Math.max(1, Number(item.quantity) || 1));
      }
      const productIds = [...new Set(items.map(item => String(item.productId || "")).filter(Boolean))];
      const productRefs = productIds.map(id => db.collection("products").doc(id));
      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));
      const productById = new Map(productRefs.map((ref, i) => [ref.id, productSnaps[i]]));
      const couponCode = String(order.couponCode || "").trim().toUpperCase();
      const couponRef = couponCode ? db.collection("coupons").doc(couponCode) : null;
      const couponSnap = couponRef ? await tx.get(couponRef) : null;

      let stockOk = true;
      const nextStocks = new Map();
      for (const [key, qty] of demand) {
        const [productId, color, size] = key.split("::");
        const snap = productById.get(productId);
        if (!snap?.exists) { stockOk = false; break; }
        const product = snap.data();
        const currentStock = nextStocks.has(productId) ? nextStocks.get(productId) : structuredClone(product.stock || {});
        const available = Number(currentStock?.[color]?.[size] || 0);
        if (available < qty) { stockOk = false; break; }
        currentStock[color] = currentStock[color] || {};
        currentStock[color][size] = available - qty;
        nextStocks.set(productId, currentStock);
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const patch = {
        paymentStatus: "paid", status: order.status === "ملغي" ? "جديد" : order.status,
        kashierTransactionId: data.transactionId || null, kashierStatus: status,
        inventoryDeducted: stockOk, inventoryStatus: stockOk ? "deducted" : "needs_review",
        updatedAt: now
      };
      if (stockOk) {
        for (const [productId, stock] of nextStocks) {
          tx.update(db.collection("products").doc(productId), { stock, updatedAt: now });
        }
      }
      if (couponRef && couponSnap?.exists && !order.couponUsageRecorded) {
        tx.update(couponRef, { usedCount: admin.firestore.FieldValue.increment(1), updatedAt: now });
        patch.couponUsageRecorded = true;
      }
      tx.update(orderRef, patch);
      notificationOrder = { ...order, ...patch, id: orderRef.id };
    });

    // Telegram is sent only after a verified SUCCESS webhook, never when checkout is merely started.
    if (notificationOrder) await notifyTelegram(notificationOrder);
    return res.sendStatus(200);
  } catch (e) {
    console.error("Kashier webhook error", e.message);
    return res.sendStatus(500);
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
  const allowedPayments = ["pending", "failed", "refunded"];
  if (req.body?.paymentStatus === "paid") return res.status(400).json({ ok: false, error: "تأكيد الدفع يتم تلقائيًا من Kashier بعد التحقق من العملية." });
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
