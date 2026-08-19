# تغییرات کامیت جدید

## 2026-08-19

### رابط کاربری و تجربه کاربری

- تم دارک از رنگ قهوه‌ای گرم به ذغالی خنثی تغییر کرد؛ پس‌زمینه کاملاً مشکی نیست و رنگ accent برنزی حفظ شده است.
- افکت Liquid Glass برای سطوح اصلی رابط شامل sidebar، topbar، command surface، کارت‌ها و مستندات اضافه و با `backdrop-filter`، blur، saturation، sheen و rim پیاده‌سازی شد.
- fallback برای `prefers-reduced-transparency` و `prefers-reduced-motion` اضافه شد.
- بهبود responsive layout برای پنل ادمین، پورتال مشتری و صفحه مستندات انجام شد.

### جست‌وجوی پنل ادمین

- command bar جدید در پنل ادمین اضافه شد.
- جست‌وجوی کلی بین بخش‌های Users، Groups and rights، Memberships، Invoices و Automation اضافه شد.
- جست‌وجو عنوان، توضیحات و محتوای هر سکشن را بررسی می‌کند.
- تب‌های نامرتبط هنگام جست‌وجو مخفی می‌شوند.
- میانبرهای `Ctrl + K` و `Cmd + K` برای فوکوس روی جست‌وجو اضافه شد.

### مستندات

- مستندات Markdown راهنمای پنل در `docs/admin-panel-guide.md` ایجاد شد.
- صفحه تعاملی مستندات با سبک Doc Builder در مسیر `/docs/admin` اضافه شد.
- نسخه Markdown از مسیر `/docs/admin.md` قابل دریافت است.
- صفحه مستندات شامل sidebar، فهرست مطالب، blockهای مستقل، جست‌وجوی مستندات، code block و طراحی responsive است.
- لینک مستندات به پنل ادمین و نوار بالایی سایت اضافه شد.

### ترجمه و پورتال مشتری

- ترجمه انگلیسی labelهای دقیق فرم ثبت‌نام اضافه شد: Company، First name، Last name، Phone، Street، Postal code و City.
- عنوان ستون‌های Properties و Units از `name` عمومی به ترجمه‌های دقیق تبدیل شد.
- گزینه‌ها و داده‌های ثبت‌شده نوع کنتور در حالت انگلیسی ترجمه می‌شوند.
- لینک تغییر زبان پورتال کاربر را در همان صفحه فعلی نگه می‌دارد.
- ترجمه محتوای اطلاعیه‌های شناخته‌شده پورتال برای عنوان و متن در حالت انگلیسی اضافه شد.
- ترجمه‌ها برای Dashboard، Announcements، Meter Readings، Properties، Units، Contact، Login و Registration تکمیل شد.

### سیستم ارسال فاکتور

- مدل جدید `PortalRechnungen` به Prisma schema اضافه شد.
- مشتری پس از ورود از مسیر `/portal/rechnungen` می‌تواند فاکتور ارسال کند.
- فیلدهای شماره فاکتور، تاریخ، مبلغ، توضیحات و فایل اضافه شدند.
- فرمت‌های PDF، JPG و PNG با حداکثر حجم ۱۰ مگابایت پذیرفته می‌شوند.
- فاکتورها با وضعیت اولیه `pending` ذخیره می‌شوند.
- مشتری فقط فاکتورهای مربوط به username و Team خودش را می‌بیند.
- دانلود فایل فاکتور برای مشتری و administrator اضافه شد.
- صفحه `My invoices` برای پیگیری وضعیت و یادداشت بررسی اضافه شد.
- سکشن `Customer invoices` به پنل ادمین اضافه شد.
- administrator می‌تواند وضعیت را به Pending، Approved، Rejected یا Needs information تغییر دهد.
- یادداشت بررسی، زمان بررسی و نام بررسی‌کننده ذخیره می‌شود.
- ترجمه کامل آلمانی و انگلیسی برای بخش فاکتورها اضافه شد.
- MIME، پسوند فایل، نام فایل و اندازه فایل قبل از ذخیره بررسی می‌شوند.

### دیتابیس و تست

- Prisma Client پس از تغییر schema تولید شد.
- دیتابیس توسعه با مدل `PortalRechnungen` به‌روزرسانی شد.
- تست‌های hard-coded مربوط به تعداد مدل‌ها با ساختار schema فعلی هماهنگ شدند.
- تست اصلی پروژه با موفقیت اجرا شد:

```text
227 tests passed
0 failed
```

- syntax فایل‌های JavaScript مربوط به server، portal، admin و i18n بررسی شد.
- health check برنامه موفق بود و دیتابیس در وضعیت ready قرار داشت.

### نکات باقی‌مانده برای توسعه بعدی

- تست end-to-end کامل ارسال و بررسی فاکتور باید اضافه شود.
- script `smoke:imports` به فایل موجود در پروژه اشاره نمی‌کند و باید اصلاح شود.
- تست Playwright ورود admin نیاز به seed و تنظیمات پایدارتر دارد.
- smoke routeها باید fake Prisma مدل فاکتور و lifecycle پورت را پشتیبانی کنند.
- migration رسمی Prisma، backup/restore و حذف پشتیبانی از plaintext password برای production باید در مرحله بعد انجام شود.
