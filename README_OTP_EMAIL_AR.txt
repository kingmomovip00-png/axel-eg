AXEL QR — التحقق بكود OTP على الإيميل (بدل اللينك)

1) في Vercel > Environment Variables ضيف:
   SMTP_HOST  (من مزوّد الإيميل، مثال smtp.hostinger.com / smtp.zoho.com)
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=axel.support@axel-eg.com
   SMTP_PASS=(باسورد الإيميل)
   MAIL_FROM_NAME=AXEL
   MAIL_FROM_ADDRESS=axel.support@axel-eg.com
   OTP_SECRET=(أي نص عشوائي طويل)
   ثم Redeploy.

2) عشان الرسالة توصل Inbox مش Spam: من DNS دومين axel-eg.com فعّل SPF وDKIM وDMARC
   (المزوّد بيديك السجلات الجاهزة في لوحة الإيميل).

3) الفلو: السوشيال -> الإيميل -> كود 6 أرقام -> الكوبون.
   الكود صالح 10 دقائق، 5 محاولات، إعادة إرسال كل دقيقة، حد 5 أكواد في الساعة لكل إيميل.

4) Firebase Authentication مبقاش مطلوب لصفحة QR.
5) غيّر أي مفاتيح كانت ظاهرة في .env.example القديم (Firebase service account / Telegram / ImageKit).
