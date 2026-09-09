AXEL — Paymob (Live-ready)

الدفع الإلكتروني في المشروع مجهز فعليًا على Paymob Intention API + Unified Checkout + Webhook HMAC-SHA512.
لا يوجد وضع تجريبي أو مفاتيح وهمية داخل المشروع.

بعد تفعيل حساب Paymob Live، في Bonto افتح Environment Variables وأضف القيم التالية:
PAYMOB_BASE_URL=https://accept.paymob.com
PAYMOB_SECRET_KEY=ضع Secret Key هنا
PAYMOB_PUBLIC_KEY=ضع Public Key هنا
PAYMOB_HMAC_SECRET=ضع HMAC Secret هنا
PAYMOB_INTEGRATION_ID_CARD=ضع Integration ID للكروت في وضع Live هنا
APP_URL=https://رابط-موقع-AXEL-النهائي

مهم:
1) لا تضع Secret Key أو HMAC Secret داخل أي ملف JavaScript أو HTML.
2) استخدم Integration ID من وضع Live مع مفاتيح Live.
3) بعد حفظ المتغيرات اعمل Restart للتطبيق.
4) العميل يختار "الدفع الإلكتروني" في checkout، وبعد إنشاء الطلب يتم تحويله إلى Paymob Unified Checkout.
5) نجاح الدفع لا يُعتبر مؤكدًا بمجرد رجوع العميل؛ السيرفر يتحقق من Webhook وHMAC ثم يحدّث حالة الطلب.

لا تحتاج إلى تعديل الكود عند تفعيل الحساب؛ المطلوب فقط إدخال القيم السابقة في Environment Variables.
