AXEL — Paymob

التكامل مبني على Paymob Intention API + Unified Checkout + Webhook HMAC-SHA512.
لا توجد بيانات تجريبية داخل المشروع.

بعد تفعيل حساب Paymob Live، أضف في Environment Variables:
PAYMOB_BASE_URL=https://accept.paymob.com
PAYMOB_SECRET_KEY=مفتاح Secret الحقيقي
PAYMOB_PUBLIC_KEY=مفتاح Public الحقيقي
PAYMOB_HMAC_SECRET=HMAC الحقيقي
PAYMOB_INTEGRATION_ID_CARD=Integration ID الخاص بالكارت في وضع Live
APP_URL=https://رابط-الموقع-الحقيقي

لا تضع Secret Key أو HMAC في ملفات JavaScript الخاصة بالواجهة.
المشروع يرفض تشغيل الدفع الإلكتروني إذا كانت بيانات Paymob ناقصة بدل تشغيل وضع تجريبي.
