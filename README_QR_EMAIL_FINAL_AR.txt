AXEL QR — نسخة التحقق بالبريد الإلكتروني

1) في Firebase Console افتح Authentication > Sign-in method وفعّل Email/Password.
2) من Authentication > Settings > Authorized domains تأكد أن axel-eg.com ودومين Vercel الفعلي موجودان.
3) في Vercel Project > Settings > Environment Variables تأكد من وجود TELEGRAM_BOT_TOKEN وTELEGRAM_CHAT_ID بالقيم الصحيحة (لا تضعهما في ملفات الموقع). أعد Deploy بعد أي تغيير.
4) يجب أن يكون FIREBASE_SERVICE_ACCOUNT_BASE64 مضبوطًا في Vercel كما في إعدادات السيرفر الحالية، مع صلاحية Firestore.
5) افتح https://axel-eg.com/qr.html أو المسار /qr حسب إعدادات rewrite. المستخدم يفتح حسابات السوشيال الثلاثة، ينشئ حسابًا ببريده، يؤكد البريد من الرسالة، ثم يرجع ويضغط زر الاستلام.
6) لوحة الإدارة > كوبونات QR تعرض البريد والكود ووقت التسجيل، ولا تعمل إلا بعد تسجيل الدخول بحساب الإدارة المصرح به.

ملاحظات: النقر على روابط السوشيال لا يثبت متابعة فعلية؛ الصفحة تطلب فتح الحسابات فقط. إصدار الكوبون يعتمد على verified email من Firebase، ويُمنح مرة واحدة لكل بريد، والتحقق من ارتباط الكوبون بالبريد يتم أيضًا عند إنشاء الطلب. Telegram notification يرسل تفاصيل التسجيل بعد إصدار أول كوبون فقط.
