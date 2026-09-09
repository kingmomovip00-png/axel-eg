AXEL ADMIN REBUILD

هذه النسخة أعادت بناء لوحة الإدارة من الصفر مع الاعتماد على الـ API الموجود في server.js.

الملفات الأساسية التي تم تغييرها:
- admin.html
- js/admin.js
- css/style.css (تمت إضافة قسم AXEL ADMIN REBUILD)

الوظائف:
1) إضافة منتج: اسم + تصنيف + أسعار + وصف.
2) ألوان متعددة ومقاسات متعددة.
3) كمية مستقلة لكل لون ومقاس.
4) اختيار صور متعددة ورفعها دفعة واحدة.
5) ربط الصور باللون المختار.
6) رسائل خطأ واضحة لكل خطوة.
7) تعديل/استبدال منتج موجود.
8) حذف منتج.
9) رفع بانر وعرضه/إخفاؤه/حذفه.
10) متابعة الطلبات وتحديث الحالة والدفع.
11) تصميم موبايل أولاً ومتجاوب.

متغيرات البيئة المطلوبة في Bonto:
IMAGEKIT_PUBLIC_KEY
IMAGEKIT_PRIVATE_KEY
IMAGEKIT_URL_ENDPOINT
ADMIN_EMAIL
FIREBASE_SERVICE_ACCOUNT_BASE64
TELEGRAM_BOT_TOKEN (اختياري للإشعارات)
TELEGRAM_CHAT_ID (اختياري للإشعارات)
FRONTEND_ORIGIN
NODE_ENV=production

مهم جداً:
- FIREBASE_SERVICE_ACCOUNT_BASE64 يجب أن يكون Service Account صحيح لنفس مشروع Firebase.
- لوحة الإدارة لا تستخدم Firestore مباشرة؛ كل العمليات تمر من خلال server.js.
- لو ظهر Missing or insufficient permissions بعد هذه النسخة، فالسبب ليس Firestore Rules الخاصة بالمتصفح، بل غالباً بيانات FIREBASE_SERVICE_ACCOUNT_BASE64 أو صلاحيات الـ Service Account/Project mismatch.
