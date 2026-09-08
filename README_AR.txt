AXEL - النسخة النهائية (Frontend + Backend)

هذا المشروع الآن يعمل كسيرفر واحد: الموقع + API في نفس الخدمة.
لا ترفع هذا المشروع على Netlify إذا كنت تريد الباك إند يعمل؛ انشره كـ Node Web Service (مثل Render أو Railway).

الملفات المهمة:
- server.js = الباك إند النهائي
- .env.example = نموذج متغيرات البيئة
- render.yaml = إعداد جاهز لـ Render
- assets/logo/logo.png = ضع اللوجو هنا
- assets/fonts/axel-font.ttf = ضع الفونت هنا

متغيرات البيئة المطلوبة:
IMAGEKIT_PUBLIC_KEY
IMAGEKIT_PRIVATE_KEY
IMAGEKIT_URL_ENDPOINT
FIREBASE_SERVICE_ACCOUNT_BASE64
ADMIN_EMAIL=axel.support.eg@gmail.com

مهم: لا ترفع .env ولا Private Keys على Netlify أو GitHub.

بعد النشر، الموقع والـ API سيكونان على نفس الدومين، لذلك لا تحتاج لتغيير localhost أو BACKEND_URL.

الموجود في الباك إند:
- Health check
- رفع صور ImageKit بشكل آمن
- حماية رفع الصور بتسجيل دخول Firebase + Email الأدمن
- حذف الصور
- إنشاء الطلبات وتحديث المخزون بشكل ذري
- تتبع الطلب برقم الطلب + الهاتف
- إحصائيات المنتجات والطلبات والمبيعات والزوار
- إشعار Telegram اختياري عند كل طلب
- نقطة Webhook جاهزة لكن بوابة الدفع نفسها تحتاج بيانات حساب التاجر وتفعيل التحقق الخاص بها
