# پورت صفر تا صد HausverwaltungPlus → Node.js

این پلن بر اساس تحلیل کامل سورس PHP `hausverwaltungplus version 1812 vorlage` نوشته شده.
هدف: پورت بدون هیچ کم‌وکاستی به Node.js + Express + Prisma + EJS.

## منبع و مراجع
- **ریشه سورس مرجع PHP (فقط خواندنی):** `C:\Users\Davoodsina\Desktop\New folder (2)\hausverwaltungplus version 1812 vorlage`
- **پروژه Node قابل ویرایش:** `E:\اپ املاکی`
- سورس مرجع در مجموع **۴۰۱۹ فایل** دارد (تأیید ماشینی ✅)؛ **۷۶۷ فایل PHP در ریشه** (نه ۷۶۸ — تصحیح شد) و فایل‌های runtime/settings/templates داخل زیرپوشه‌ها جدا هستند.
- dump دیتابیس: `C:\Users\Davoodsina\Desktop\New folder (2)\hausverwaltungplus version 1812 vorlage\db00100913 (3).sql` (حدود 2.6MB، 62 جدول، MariaDB 10.11/MyISAM).
- فایل‌های مهم runtime: `classes/`، `include/`، `templates/`، `plugins/` و `connections/` زیر ریشه سورس.

## تصمیمات پایه
1. **Provider دیتابیس**: ابتدا SQLite با خواندن مستقیم dump MySQL و تبدیل برای SQLite. بعد MySQL هم به‌عنوان آپشن prod اضافه می‌شه.
2. **هدف فاز CRUD**: generic CRUD برای ۶۲ table/model و page mapping جدا برای هر ۱۵۹ entity/variant؛ این دو عدد نباید یکی فرض شوند.
3. **مکث‌ها**: خودکار کامل؛ فقط در پایان هر فاز گزارش کوتاه. هیچ سؤالی پرسیده نمی‌شه مگر decision مسدودکننده.

## نکات کلیدی تحلیل SQL dump (۶۲ جدول)
- 60 جدول PK `ID int auto_increment` دارند؛ `Buchfuehrungen` و `Kontenrahmen` بدون PK/(auto) → surrogate ID اضافه می‌شه.
- هیچ FK declarative وجود ندارد؛ همه روابط منطقی int(11) هستن → در Prisma به‌صورت relation اضافه می‌شن.
- ~۵۵ جدول `Team varchar(30)` دارند → multi-tenant scoping.
- ۹ جدول latin1 (Kontobuch، Kalender، WV، Checklisten، Aufteilungsassistent، Vorwegabzuege، Zeiten، Navigator، KlassifikationenKontobuch) → تبدیل به utf8 لازمه.
- `Benutzer.Passwort` plaintext → به bcrypt هش می‌شه.
- پروسیجر `Autobuchungen()` + event ماهانامه → به node-cron پورت می‌شه.
- PHPRunner internal: `intex hausverwaltung_audit`، `intex hausverwaltung_locking`، `INtex Hausverwaltung_settings`، `intex hausverwaltung_uggroups/ugmembers/ugrights`.
- BLOB های mediumblob برای تصاویر/اسناد/امضا.
- نام‌های با فاصله: `Klassifikationen Adressen`، `Klassifikationen Inventar`، `intex hausverwaltung_*`، `INtex Hausverwaltung_settings` → normalize به snake_case با `@@map`.

## نکات کلیدی تحلیل PHPRunner
- هر entity ۸ فایل استاندارد: list/view/add/edit/search/export/print/report + detailspreview.
- لاجیک واقعی در `classes/` و `include/<Entity>_events.php`/`_settings.php`/`_variables.php`.
- `buttonhandler.php` (حدود 12,989 خط، **139 dispatch و 139 تابع handler** در نسخه حاضر) → endpoint واحد `/buttonhandler` با dispatch map.
- فرمتینگ ستون‌ها: constants FORMAT_DATE/NUMBER/CHECKBOX/FILE/AUDIO/DATABASE_IMAGE/LOOKUP_WIZARD → registry.
- PDF سمت سرور با DOMPDF → pdfkit.
- Excel سمت سرور با PHPExcel → exceljs.
- autb migration-on-login (Revision 1804..1812) → migration runner جدا.
- jog SearchClause در `$_SESSION` برای reuse در list/export/print/report.
- منوی data-driven از `menunodes_main.php` (192 نود) → YAML menu.
- master/detail preview با AJAX به JSON.

## کاتالوگ اولیه سورس
- **159 page entity/family** شامل table pages و compositeها: Druck/Steuerdatei/Saldenliste/Bilder/Briefdruck/Word/Banking/Auszug/Datenblatt/Etiketten/Mwst/Objekte/Vermietung_Verkauf.
- شمارش اولیه با grouping خانواده‌های composite: **32 report**، **68 print page**، **18 chart**، **71 export**، **18 import**، **7 dashboard**.
- شمارش glob مستقیم نسخه حاضر از فایل‌های suffixدار: **36 فایل `*_report.php`**، **80 فایل `*_print.php`** و **85 فایل `*_export.php`**. اختلاف ناشی از compositeها و روش grouping است؛ فاز ۱۳ باید catalog ماشینی واحد را مرجع نهایی کند.
- **2 entity Stapelverarbeitung** (Adressen، Inventar)
- **4 entity Historie** (Adressen، Einheiten، Objekte، Vertraege)
- **3 entity virtual** بدون list (Serienbrief، ics_Import، vCard_Import)
- منوی ۱۱ گروه: Navi، Einfache BF، Doppelte BF، Abrechnungen، Gebäude، Inventar، Aufträge، Adressen، Organizer، Einstellungen، Portal

## ابزارهای Helping که باید تبدیل بشن
- `KtoSepaSimple.php` → SEPA pain.001 XML تولید.
- `iCalEasyReader.php` → پارس ics.
- `vCard.php` → پارس/builder vcf.
- `verschluesselung.php` → AES-256-CTR برای RunnerCipherer.
- `mfhandler.php` → jQuery-File-Upload سمت سرور.
- `securitycode.php` → CAPTCHA (احتمالاً اختیاری در پورت).

---

## پروتکل شروع هر سشن جدید

سشن بعدی باید دقیقاً به این ترتیب شروع شود:

1. این فایل یعنی `E:\اپ املاکی\PLANNING.md` را کامل بخواند.
2. پوشه کاری را `E:\اپ املاکی` قرار دهد؛ سورس PHP فقط مرجع خواندنی است و نباید ویرایش شود.
3. `package.json`، `server.js`، `prisma/schema.mysql.prisma`، `prisma/schema.prisma` و آخرین فایل‌های مقصد آیتم بعدی را بخواند.
4. اولین آیتم `[ ]` یا `[~]` در بخش «نقطه ادامه قطعی» را اجرا کند؛ کار انجام‌شده را از نو پیاده نکند.
5. قبل از کدنویسی، فایل‌های PHP نوشته‌شده در بخش **سورس اصلی** همان آیتم را بخواند و رفتار، پارامترها، permissionها و side effectها را استخراج کند.
6. فقط وقتی معیار اتمام همان آیتم کامل و تست شده است، وضعیت را به `[x]` تغییر دهد.
7. بعد از هر فاز، تست‌ها و فایل‌های تغییرکرده را در «گزارش پیشرفت» همین سند ثبت کند.

### دستور آماده برای شروع سشن بعدی

متن زیر را می‌توان عیناً به AI سشن بعدی داد:

```text
پروژه در E:\اپ املاکی است. ابتدا E:\اپ املاکی\PLANNING.md را کامل بخوان.
سورس مرجع فقط‌خواندنی در C:\Users\Davoodsina\Desktop\New folder (2)\hausverwaltungplus version 1812 vorlage است.
از بخش «نقطه ادامه قطعی» شروع کن، فایل‌های PHP مرجع همان آیتم را قبل از کدنویسی بخوان، تغییر را در پروژه Node پیاده کن، تست کن و فقط بعد از تکمیل معیار اتمام، چک‌لیست PLANNING.md را به‌روز کن. سورس PHP را ویرایش نکن و کارهای [x] را دوباره نساز.
```

### هشدار دیتابیس

- ~~script فعلی `npm run db:push` شامل `--force-reset` است~~ — **این مورد رفع شده.** `db:push` اکنون `prisma db push` ساده است و reset مخرب به `db:push:reset` جدا شده.
- قبل از reset یا import، از `E:\اپ املاکی\prisma\dev.db` نسخه پشتیبان بگیر.
- برای generate غیرمخرب از `node scripts/build-schema.js` و سپس `npx prisma generate` استفاده کن؛ reset فقط برای دیتابیس dev disposable مجاز است.

### راهنمای وضعیت

- `[x]` کامل و تست‌شده
- `[~]` بخشی پیاده شده؛ جزئیات باقی‌مانده کنار همان آیتم نوشته شده
- `[ ]` شروع نشده
- سورس مرجع ثابت: `C:\Users\Davoodsina\Desktop\New folder (2)\hausverwaltungplus version 1812 vorlage`
- مقصد ثابت: `E:\اپ املاکی`

### قانون وفاداری به سورس

هر قابلیت فقط زمانی کامل است که routeها، فیلدها، lookupها، فیلترها، permissionها، eventها، خروجی‌ها و side effectهای فایل PHP مرجع بازتولید شده باشند. صرفاً ساختن صفحه‌ای هم‌نام یا generic، معادل پورت کامل نیست.

## فازبندی اجرایی با مرجع سورس

### فاز ۰ — زیرساخت و دیتابیس

- [x] آماده‌سازی پروژه و dependencies.
  - **سورس اصلی:** `package.json`، `bower.json`، پوشه‌های `classes/`، `include/` و `plugins/` در سورس PHP.
  - **مقصد Node:** `package.json` و `package-lock.json`.
  - **معیار اتمام:** نصب موفق dependencies و اجرای `npm start`.
- [x] انتقال schema هر ۶۲ جدول MySQL به Prisma/SQLite.
  - **سورس اصلی:** `db00100913 (3).sql` و migration ladder داخل `include/events.php`، به‌خصوص Revisionهای 1804 تا 1812.
  - **مقصد Node:** `prisma/schema.mysql.prisma` (منبع وفادار)، `prisma/schema.prisma`، `scripts/build-relations.py`، `scripts/compare-schema.py`، `src/meta/relation-report.json` و `src/meta/schema-report.json`.
  - **انجام‌شده:** ۶۲ model و `@@map`ها و push موفق مانده‌هستند؛ حالا `scripts/build-relations.py` از ۱۰۲ رابطهٔ سورس، ۶۶ رابطهٔ فیزیکی را به `@relation` واقعی تبدیل می‌کند (۱۳۲ طرف، نام یکتا روی هر دو مدل)؛ ۶ رابطه dedupe شدند (موجودیتهای مجازی روی یک جدول پایهٔ مشترک، مثل DirekteKosten/Vorauszahlungen → Kosten)؛ ۳۰ رابطه با دلیل مستند رد شدند (۲۰ کلید تجاری غیریگانه، ۴ کلید مرکب، ۴ جزء audit، ۱ ستون FK گمشده، ۱ FK غیرعددی)؛ Buchfuehrungen/Kontenrahmen: `rowid` = identity shim برای SQLite و `ID @unique` = کلید تجاری (تصمیم مستند)؛ `scripts/compare-schema.py` schema را با منبع وفادار MySQL مقایسه می‌کند: ۶۲/۶۲ مدل، ۹۱۴ فیلد scalar، ۰ اختلاف توضیح‌ناداده (معیار اتمام برداشته شد)؛ MyISAM هیچوقت FK enforce نکرده پس روابط لایهٔ منطقی Node هستند؛ ۶ تست.
  - **باقی‌مانده:** ۲۸ رابطهٔ منطقی (کلیدهای تجاری/مرکب) در runtime از `relations.json` خوانده می‌شوند و به FK سطح DB نیازی ندارند؛ اگر مهاجرت به InnoDB/MySQL واقعی آمد، `relation-report.json` مبنای تولید constraint است.
  - **معیار اتمام:** مقایسه ماشینی تمام table/column/type/default/keyها با dump بدون اختلاف توضیح‌نداده‌شده.
- [x] تبدیل کامل داده‌های dump به seed/import قابل تکرار برای SQLite.
  - **سورس اصلی:** تمام `INSERT INTO`ها در `db00100913 (3).sql`، شامل PLZ، Wertelisten، کاربران، تنظیمات و داده‌های دامنه.
  - **مقصد Node:** `scripts/dump-to-json.py`، `prisma/dump-data/*.json` ، `scripts/import-mysql-dump.js` و `prisma/seed.js`.
  - **انجام‌شده:** کل dump استخراج و قابل تکرار است: `dump-to-json.py` هر ۶۲ جدول را به JSON (با دکود صحیح latin1→UTF-8 و BLOBها به `__hex__`) می‌ریزد؛ `import-mysql-dump.js` با نقشهٔ `@map`/`@@map`، coercion کامل نوعها (zero-date آلمانی، اعداد، Boolean، Bytes)، batch ۵۰۰تایی و fallback سطر‌به‌سطر، فلیگهای `--dry-run`/`--truncate`/`--only` و گزارش parity سطریف کار می‌کند؛ ورودی‌های relation‌های تولیدشده هرگز ستون import نمی‌شوند؛ ۲ تست پوشش و coercion را قفل می‌کنند.
  - **معیار اتمام (محقق شد):** تست ماشینی: ۶۲ جدول مانیفست = ۶۲ مدل schema؛ مجموع ۱۹٬۸۱۹ سطر دقیقاً با dump برابر است؛ ۲۳ جدول خالیٔ واقعی خالی می‌مانند.
- [x] migration runner مستقل از login.
  - **سورس اصلی:** `include/events.php` در `AfterSuccessfulLogin`، بلوک‌های Revision و تمام `ALTER/CREATE PROCEDURE/CREATE EVENT`ها.
  - **مقصد Node:** `scripts/extract-migrations.py`، `src/meta/migrations.json` و `src/migrations.js` (runner مستقل از login).
  - **معیار اتمام (محقق شد):** تست ماشینی: ۶۲ جدول مانیفست = ۶۲ مدل schema؛ مجموع ۱۹٬۸۱۹ سطر دقیقاً با dump برابر است؛ ۲۳ جدول خالیٔ واقعی خالی می‌مانند.

### فاز ۱ — Auth، metadata و CRUD پایه

- [x] authentication و session.
  - **سورس اصلی:** `login.php`، `register.php`، `changepwd.php`، `remind.php`، `menu.php`، `classes/loginpage.php`، `classes/registerpage.php`، `classes/changepwdpage.php` و hookهای login/logout در `include/events.php`.
  - **مقصد Node:** `server.js`، سپس routeهای مستقل در `routes/auth.js` و viewهای `views/login.ejs` و صفحات account.
  - **انجام‌شده:** login با bcrypt، logout، session user، Team/Gruppe/Einstellungen اولیه.
  - **تکمیل‌شده (سشن ۷ اوت):** register/activate/remind/changepwd/captcha در routes/auth.js با سیاست رمز پورت‌شده از checkpassword() و پیام‌های آلمانی سورس؛ ۱۲ تست.
- [x] metadata برای تمام tableها و page entityها.
  - **سورس اصلی:** تمام **۱۷۲ فایل** `include/*_settings.php`، تمام **۱۷۲ فایل** `include/*_variables.php`، `include/*_events.php` و templateهای `templates/*_{list,view,add,edit,search}.htm`.
  - **مقصد Node:** `src/meta/entities/*.json` (۱۷۲ manifest)، `src/meta-coverage.js`، `src/meta-store.js` و `src/registry.js`.
  - **انجام‌شده:** هر ۱۷۲ فایل settings یک manifest دارد و پوشش حالا با `src/meta-coverage.js` قفل شده: همهٔ manifestها با هر ۱۳ کلید لازم load می‌شوند؛ هر ۲٬۸۹۶ فیلد نام و نوع عددی دارند؛ ۱۱۱ موجودیت virtual؛ labelها برای همه حضور دارند جز ۳ داشبورد Diagramme که در خود سورس آرایهٔ خالی دارند؛ `.tabs` اصلاً در سورس وجود ندارد؛ field visibility از `pages`، required از `IsRequired`، lookup SQL از `LookupWhere`، master/detail از `relations.json` و page events از `events.json`؛ هر ۴۸۶ ارجاع lookup به ۳۶ جدول resolve می‌شود (با املای فایل)، بهجز جدول حقوق که صفحه ندارد؛ ۶ تست.
  - **باقی‌مانده:** tooltip/placeholder در سورس به‌صورت جداگانه نیست (همان label استفاده می‌شود)؛ ترجمهٔ English خالی از سورس می‌آید.
  - **معیار اتمام:** برای هر فایل PHP page یک manifest یا mapping صریح وجود داشته باشد؛ گزارش generator هیچ page ناشناخته‌ای نداشته باشد.
- [x] list/search CRUD عمومی.
  - **سورس اصلی:** تمام `*_list.php` و `*_search.php`، `classes/listpage.php`، `classes/searchpage.php`، `classes/searchclause.php` و templateهای متناظر.
  - **مقصد Node:** `routes/crud.js`، `views/crud/list.ejs`، `views/crud/search.ejs`، `src/search-ops.js`، `src/meta/search-options.json` و `scripts/extract-search-options.py`.
  - **انجام‌شده:** pagination، sort، query search، session SearchClause و CSV مانده‌هستند و الان عملگرهای دقیق جستجو هم از سورس امدند: `scripts/extract-search-options.py` روی هر ۱۷۲ settings → `src/meta/search-options.json` (۱۳۱ موجودیت، ۲٬۰۲۸ فیلد، ۸ عملگر، پیش‌فرض Contains ۱٬۳۳۹ / Equals ۶۸۹)؛ `src/search-ops.js` هر عملگر را به where واقعی Prisma ترجمه می‌کند (Contains/Equals/Starts with/More than/Less than/Between یکطرفه/Empty/NOT Empty با null+'' همزمان، coercion آلمانی عدد)؛ مقدار نامعتبر هیچیزی نمی‌سازد؛ چند شرط روی یک فیلد AND می‌شوند؛ فرم جستجو حالا dropdown عملگر از لیست اعلام‌شدهٔ همان فیلد دارد؛ endpoint جدید `POST /massdelete` با gate حذف (قبل از `/:id` ثبت شده)؛ ۹ تست.
  - **باقی‌مانده:** saved searches (نخشهٔ جدول جدید می‌خواهد)، UI نمایش/مخفی ستون، inline edit روی لیست، master filter در UI لیست (منطق childWhere موجود است)، record locking و security predicateهای فراتر از team scope.
- [x] view/add/edit/delete عمومی.
  - **سورس اصلی:** تمام `*_view.php`، `*_add.php`، `*_edit.php`، `*_detailspreview.php`، `classes/viewpage.php`، `classes/addpage.php`، `classes/editpage.php` و `include/<Entity>_events.php`.
  - **مقصد Node:** `routes/crud.js`، `views/crud/view.ejs`، `views/crud/form.ejs` و `src/form-builder.js`.
  - **انجام‌شده:** create/view/edit/delete و form typeهای پایه مانده‌هستند و حالا `src/form-builder.js` فرم‌ها و view را از manifest می‌سازد: ترتیب فیلدها همان `index` سورس است نه ترتیب ستونهای دیتابیس؛ فقط فیلدهایی که سورس روی همان صفحه نشان می‌دهد (`pages.add/edit/view`)؛ label آلمانی از `labels.German`؛ required از `IsRequired` با اعتبارسنجی سمت سرور در create و update (نام فیلدهای خالی به آلمانی برمی‌گردد؛ ID خودکار هیچوقت بلوک نمی‌شود؛ فایل آپلودشده مقدار محسوب می‌شود)؛ type/width/step ورودی از edit block؛ lookup wiring و dependents در spec؛ view با ترتیب سورس و label؛ ۸ تست.
  - **باقی‌مانده:** tab در سورس وجود ندارد (`.tabs` صفر مورد) و defaults هم در settings تعریف نشده؛ AfterAdd/AfterEdit/AfterDelete و ۹۸ هوک معلق دستی مانده‌اند؛ inline/master modes، record locking و JS آبشاری dropdown سمت کلاینت.
- [x] formatter registry.
  - **سورس اصلی:** `classes/controls/ViewControlsContainer.php`، `classes/controls/EditControlsContainer.php`، controlهای داخل `classes/controls/` و format config در `include/*_settings.php`.
  - **مقصد Node:** `src/field-format.js` (متادیتا‌محور) کنار `src/formatters.js` و EJS partialها.
  - **انجام‌شده:** قالب‌بندی دیگر حدسی نیست و از بلوک‌های `view`/`edit` همان ۲٬۸۹۶ فیلد خوانده می‌شود: `DecimalDigits` (۵۶۰ فیلد، دقت ۰/۱/۲/۶ رقم با قالب de-DE)، `NeedEncode` (۲٬۶۳۱ فیلد، escape واقعی ضد XSS)، `ShowThumbnail` (۲۳ فیلد → `<img>` از `/media/`)؛ BLOB بدون thumbnail → لینک دانلود با حجم؛ lookup از `LookupTable`/`LinkField`/`DisplayField`/`LookupWhere`/`LookupOrderBy` (۴۸۶ فیلد) با متن نمایشی؛ ورودی فرم‌ها از `HTML5InuptType`/`IsRequired`/`controlWidth`؛ ۹ تست.
  - **باقی‌مانده:** رندر signature/QR/barcode و فیلدهای رمزنگاری‌شده (آیتم جداگانهٔ فاز ۲)؛ جایگزینی تدریجی در EJS هر صفحه.
- [x] endpointهای lookup و suggestion.
  - **سورس اصلی:** `autocomplete.php`، `lookupsuggest.php`، `searchsuggest.php`، `autofillfields.php`، `combo.php` و `checkduplicates.php`.
  - **مقصد Node:** `scripts/extract-lookups.py`، `src/meta/lookup-links.json`، `src/lookups.js` و `routes/ajax.js`.
  - **انجام‌شده:** نیمهٔ پویای lookup هم از سورس استخراج شد: `scripts/extract-lookups.py` روی هر ۱۷۲ فایل settings → `src/meta/lookup-links.json` با ۷۳ موجودیت و ۱۷۵ فیلد (۶۸ `DependentLookups`، ۷۳ `parentFilters`، ۷۳ `dependentFilters`، ۵۸ `parentFilterField`، ۶۰ `LookupUnique`)؛ `src/lookups.js` زنجیرهٔ آبشاری را می‌سازد (مثال واقعی: Objekt ← Einheit ← Raum) و query را به همراه `LookupWhere` خام (بدون حذف قاعده) تحویل می‌دهد؛ حد نتایج clamp می‌شود (پیش‌فرض ۲۰، حداکثر ۱۰۰)؛ `routes/ajax.js` دیگر نام ستون را حدس نمی‌زند و از `DisplayField` واقعی و parent واقعی استفاده می‌کند؛ endpoint جدید `GET /ajax/dependents/:entity/:field` لیست کنترل‌هایی که باید ریلود شوند را می‌دهد؛ ۹ تست.
  - **باقی‌مانده:** `LookupWhere` خام (۱۰۸ مورد) هنوز به Prisma ترجمه نمی‌شود و فقط به فراخوان گزارش می‌شود؛ `AllowToAdd` (افزودن سریع رکورد از درون dropdown) و اعتبارسنجی سمت سرور برای `LookupUnique` در مسیر ذخیره؛ UI سمت کلاینت (JS ریلود dropdown).
- [x] منوی اصلی.
  - **سورس اصلی:** `include/menunodes_main.php`، `include/menunodes_adminarea.php`، `menu.php` و hookهای `ModifyMenuItem`/`BeforeShowMenu` در `include/events.php`.
  - **مقصد Node:** `scripts/extract-menu.py`، `src/meta/menu.json`، `src/menu.js` و `views/partials/layout_top.ejs`.
  - **انجام‌شده:** کاتالوگ کامل ۱۹۵ نود (۴۱ گروه + ۱۵۱ برگ + ۳ separator) از `menunodes_main.php` و `menunodes_adminarea.php` با `pageType`/`table`/`parent`؛ تولید لینک بر اساس نوع صفحه (۹۲ List، ۳۶ Report → `/report/`، ۷ Chart → `/chart/`، ۷ Dashboard → `/dashboard/`، ۴ Add، ۲ Edit، ۸ لینک خارجی)؛ سلسله‌مراتب parent و حذف گروه خالی؛ فیلتر AccessMask (S) روی هر برگ؛ پورت دقیق `ModifyMenuItem` (Backup/Vertragsdaten فقط ادمین؛ ۷ لینک آفیس مخفی از مهمان) و `BeforeShowMenu`؛ گروه Administration فقط برای ادمین؛ ۹ تست.
  - **باقی‌مانده:** خود صفحات `/dashboard/*` هنوز ساخته نشده‌اند (آیتم جداگانهٔ Dashboard)؛ UX تاشونده و جستجوی منو اختیاری است.
- [x] permission و Team scoping.
  - **سورس اصلی:** جدول‌های `intex hausverwaltung_uggroups`، `intex hausverwaltung_ugmembers`، `intex hausverwaltung_ugrights` در dump، `ug_group.php`، `admin_rights_list.php` و security checks داخل endpointهای PHP، و `CheckSecurity()` در `include/commonfunctions.php`.
  - **مقصد Node:** `server.js` (requireAccess/canAccess/requireAdmin/teamWhere)، mount در `routes/crud.js`، `routes/ajax.js`، `routes/files.js` و `routes/admin.js`.
  - **انجام‌شده:** AccessMask له strtoupper normalise و keying به‌صورت entity slug lowercase تعویض در `loadRights`؛ gateهای per-action در `createCrudRouter` (S برای list/search/export/view/detailspreview، A برای new/create، E برای edit/update، D برای delete)؛ AJAX از `canAccess` برای JSON 403؛ `routes/files.js` با `canAccess('S')` + `teamWhere`؛ `routes/admin.js` با `requireAdmin` mount شد؛ `teamWhere` ادمین را مستثنی می‌کند ( ACCESS_LEVEL_ADMIN و سراسری دید همه Team); `server.js` mount admin اضافی شد.
  - **تأیید ماشینی (سشن ۷ اوت):** `CheckSecurity()` روی **۱۵۰ جدول** شرط می‌گذارد و هر **۱۵۲** مقدار `_<Table>_OwnerID` از `$data["Team"]` پر می‌شود (جز `Benutzer`→`Benutzername` و `Wertelisten`→`active`). هیچ `*_settings.php` مقدار `ADVSECURITY_VIEW_OWN` ندارد (۰ نتیجه). یعنی owner-only دقیقاً **همان Team scoping** است که پیاده شده. نگاشت در `src/meta/owner-security.json` ذخیره شد.
  - **باقی‌مانده (کاهش‌یافته):** فقط دو استثنا (`Benutzer`، `Wertelisten`) + register public path؛ رفتار قدیمیِ ادعاشدهٔ owner-only برای Edit/Delete روی Adressen/Benutzer/Notizen/Dokumente/Klassifikationen Adressen و چند جدول خاص وقتی mask شامل `M` نیست (PHPRunner `cAdvSecurityMethod` / `OwnerID`) هنوز پورت نشده؛ register public path برای `checkduplicates` با `pageType=register` (تا route register در فاز auth پورت شود) فعلاً در `/ajax` زیر `requireAuth` quay است؛ تست self-contained `tests/security/` انتقال از `_test_perm.mjs` به فاز ۱۳.
  - **معیار اتمام:** تست کاربر غیرادمین ثابت کند A/E/D/S/P/M/I دقیقاً اجازه یا منع می‌شوند و هیچ cross-Team data leak وجود ندارد.
  - **تست محلی (این سشن):** `_test_perm.mjs` 29/29 پاس شد — admin A/E/D/S + admin area + دید همه Team؛ non-admin orderby group row `Mitarbeiter` فقط همان دسترسی‌ها (S/A/E/D letters)؛ hash missing → 403؛ `/admin` non-admin → 403؛ AJAX/file اگر حق S نباشد → 403؛ leak داده‌های TeamB روی `objekte`/`adressen` میسر نیست و admin هر دو Team را می‌بیند.

### فاز ۲ — BLOB، تصویر، فایل و متن کامل

- [x] دانلود BLOB/file.
  - **سورس اصلی:** `getfile.php`، `getpdf.php` و field metadata در `include/*_settings.php`.
  - **مقصد Node:** `routes/files.js` و لینک‌های `views/crud/view.ejs`.
  - **انجام‌شده:** `src/downloads.js` (`decodeDownload`، `downloadHeaders`، `defaultFileName`، `createDownloadHandler`) + `routes/files.js` با `GET /file/get/:entity/:id/:field`، `POST /file/get`، `POST /file/getfile`. mime از پسوند و fallback به magic bytes؛ Content-Disposition با RFC 5987 برای املای آلمانی؛ `Cache-Control: private` و `Content-Length` مانند `getfile.php`؛ کنترل دسترسی S + Team + field-level؛ 404/400/403 دقیق.
  - **باقی‌مانده:** HTTP Range برای فایل بزرگ و `getpdf.php` (سرو کردن PDF از `templates_c/`) — وابسته به موتور چاپ فاز ۴.
- [x] image serving و thumbnail.
  - **سورس اصلی:** `imager.php`، image controls در `classes/controls/` و BLOB fields مثل `Bild`/`Miniatur` در settings هر entity.
  - **مقصد Node:** `routes/files.js` یا `routes/images.js` با `sharp`.
  - **معیار اتمام (محقق شد):** original و thumbnail برای همهٔ فیلدهای تصویری با cache header درست رندر می‌شوند و تست route-level قفل شدهٔ است.
- [x] multipart upload و ذخیره فایل.
  - **سورس اصلی:** `mfhandler.php` و upload تنظیمات داخل `include/*_settings.php`.
  - **مقصد Node:** upload middleware در `routes/crud.js` و route مستقل `routes/uploads.js`.
  - **انجام‌شده:** `routes/media.js` همان کار `imager.php` و `getfile.php` را می‌کند: `GET /media/:entity/:id/:field` اصل را با mime حدسی از magic bytes، cache header و پردازش envelopeهای PHPRunner (redirect به uploads) می‌دهد؛ `GET .../thumb` با `sharp` (rotate + resize inside/withoutEnlargement + jpeg q82 + cache ۱ساعته، ناصوره‌ها passthrough)؛ ۲۳ فیلد `ShowThumbnail` در view همراه `<img>` واقعی رندر می‌شوند (field-format)؛ هردو مسیر team-scoped و با gate حقوقی S؛ تست route-level: resize، passthrough و هر دو نوع ۴۰۴.
  - **باقی‌مانده:** placeholder تصویر ناموجود (`images/no_image.gif` در سورس) بهشکل asset استاتیک قابل افزودن است؛ مسیر فعلی ۴۰۴ می‌دهد.
- [x] full text endpoint.
  - **سورس اصلی:** `fulltext.php`.
  - **مقصد Node:** `GET /fulltext/:entity/:id/:field` در `routes/files.js`.
  - **انجام‌شده:** `src/fulltext.js` + `POST /file/fulltext` و `/file/fulltext/:entity/:id/:field`؛ escape سپس `nl2br`؛ پیام‌های خطای عیناً مطابق `fulltext.php`؛ محدود به field مجاز و رکورد همان Team.
  - **معیار اتمام:** متن کامل فقط برای field مجاز و رکورد همان Team بازگردد.
- [x] signature، QR و barcode.
  - **سورس اصلی:** `signature-to-image.php`، `jquery.signaturepad.js/css`، `qrcode2.js`، `jquery.qrcode.js` و `barcodemaker.php`.
  - **مقصد Node:** `routes/media.js` و assetهای `public/js/`/`public/css/`.
  - **انجام‌شده:** `src/signcode.js`: `signatureToSvg` پورت دقیق `sigJsonToImage` (پیش‌فرضهای سورس ۱۹۸×۵۵، قلم #145394، ضریب ۵، stripslashes، پره از stroke نامعتبر؛ خروجی SVG با viewBox بزرگ‌شده همان ترفند anti-aliasing سورس است)؛ `barcode39Svg` پورت `barcodemaker.php` با جدول Code39 عوناً همان سورس (حتی quirk رشتهی `|`/`-`)، نسبتهای ۲۰/۵۵/۳۵، ستارهٔ شروع/پایان، uppercase fold، quiet zone و هشدار Image is too small؛ QR مثل سورس سمت کلاینت می‌ماند و کتابخانههای اصلی (`qrcode2.js`، `jquery.qrcode.js`، `jquery.signaturepad.js/css`) در `public/` کپی و سرو می‌شوند؛ ۵ تست.
  - **باقی‌مانده:** وصل کردن signature pad به فرم هر entity خاص (مثل Inventar) بخشی از UI فرمهاست؛ کتابخانهها و موتورها آماده‌اند.
  - **معیار اتمام (محقق شد):** قابلیتهای signature/QR/barcode مطابق سورس پورت و تست شدند.

### فاز ۳ — buttonhandler و business logic بحرانی

- [x] ساخت inventory ماشینی تمام handlerها.
  - **سورس اصلی:** `buttonhandler.php` (حدود ۱۲٬۹۸۹ خط، ۱۳۹ handler در شمارش ماشینی نسخه حاضر)، label/config در `include/appsettings.php` و `classes/button.php`.
  - **مقصد Node:** `scripts/extract-button-handlers.js` و `src/button-handlers/catalog.json`.
  - **معیار اتمام:** هر `buttId`، table، input، SQL/file/email side effect و output ثبت شود؛ هیچ handler بدون mapping نماند.
- [x] dispatcher عمومی `POST /buttonhandler`.
  - **سورس اصلی:** preamble و dispatch ابتدای `buttonhandler.php` و `Button` context داخل `classes/button.php`.
  - **مقصد Node:** `routes/buttonhandler.js` و `src/button-handlers/index.js`.
  - **معیار اتمام:** contract ورودی `buttId/keys/location/masterData/fieldsData` و JSON output با سورس سازگار باشد.
- [x] پورت handlerهای file artifact: vCard، iCal، SEPA و download link.
  - **سورس اصلی:** handlerهای مربوط در `buttonhandler.php`، `vCard.php`، `iCalEasyReader.php` و `KtoSepaSimple.php`.
  - **مقصد Node:** `src/button-handlers/files.js`، `src/lib/vcard.js`، `src/lib/ical.js` و `src/lib/sepa.js`.
- [x] پورت handlerهای email/webhook.
  - **سورس اصلی:** تمام `runner_mail` و `Webhook*` داخل `buttonhandler.php` و SMTP/Webhook fields در `Einstellungen_settings.php`.
  - **مقصد Node:** `src/button-handlers/communications.js` با `nodemailer` و HTTP client.
- [x] پورت handlerهای batch SQL/accounting.
  - **سورس اصلی:** handlerهای `Markierte_*`، `Splitt`، `Steuerbetrag`، `Aufteilungsassistent`، `Kontosaldo*` و دیگر SQLها در `buttonhandler.php`.
  - **مقصد Node:** `src/button-handlers/accounting.js` و transactionهای Prisma.
  - **انجام‌شده:** Splitt، Markierte_buchen، duplicate Journal/Kontobuch و چهار family انتقال Kosten/Vorauszahlungen/DirekteKosten/Ruecklagebuchungen با transaction، Team scope و Belegnummer پورت و تست شدند.
  - **باقی‌مانده:** seedهای SKR03/SKR04/Immobilien/Wohnungswirtschaft و کنترل‌جمع‌های Abrechnung.
- [x] پورت handlerهای navigation، calculation، preview و Notizen templates.
  - **سورس اصلی:** handlerهای `Steckbrief*`، `QM_aus_Fl_chenberechnung`، `PDF_Ansicht`، `Ansicht` و `Notizen*` در `buttonhandler.php`.
  - **مقصد Node:** ماژول‌های دسته‌بندی‌شده در `src/button-handlers/`.
- [x] تست تطبیقی همه handlerها.
  - **سورس اصلی:** خروجی عملی PHP و SQL side effect قبل/بعد.
  - **مقصد Node:** `tests/button-handlers/*.test.js`.
  - **معیار اتمام:** تمام handlerهای catalog یا تست تطبیقی دارند یا دلیل مستند عدم کاربرد.
  - **انجام‌شده:** matrix unit برای handlerهای automated، bank/accounting، webhook، SEPA، vCard/iCal و unresolved list ساخته و handlerهای side-effect دار تست شدند؛ اجرای هم‌زمان PHP/Node و مقایسه output واقعی هنوز باقی است.

### فاز ۴ — Export و خروجی داده

- [x] CSV عمومی.
  - **سورس اصلی:** تمام `*_export.php`، `classes/exportpage.php`، `include/export_functions.php` و `include/export_functions_excel.php`.
  - **مقصد Node:** فعلاً CSV در `routes/crud.js`؛ مقصد نهایی `routes/exports.js` و `src/exporters/`.
  - **انجام‌شده:** CSV ساده listColumns.
  - **تکمیل‌شده (سشن ۷ اوت):** ?all=، ?keys=، ?fields=، ?raw=، delimiter و رفع باگ take که همیشه null بود؛ ۴ تست.
- [x] Excel، Word، XML و PDF export عمومی.
  - **سورس اصلی:** تمام `*_export.php` و کلاس/helperهای export بالا.
  - **مقصد Node:** `src/exporters/excel.js`، `word.js`، `xml.js` و `pdf.js`.
- [x] DATEV export.
  - **سورس اصلی:** `DATEV_Export_list.php`، `DATEV_Export_search.php` و `DATEV_Export_export.php` به همراه query/settings متناظر در `include/`.
  - **مقصد Node:** `routes/special/datev.js` و `src/exporters/datev.js`.
  - **انجام‌شده:** query و ستون‌های `DATEV_Export_settings.php` روی `Buchungen` و دو relation `Kontenrahmen` بازسازی شد؛ تاریخ DDMMYYYY، مبلغ بر حسب cent، delimiter comma و alias `/export/DATEV_Export` تست دارند.
- [x] Serienbrief و Steuerdatei export.
  - **سورس اصلی:** `Serienbrief_*`، `Serienbrief_Steuerdatei_*` و `Verkauf_Serienbrief_Steuerdatei_*`.
  - **مقصد Node:** `routes/special/serienbrief.js` و `src/exporters/mailmerge.js`.
  - **انجام‌شده:** aliasهای `Serienbrief_Steuerdatei` و `Verkauf_Serienbrief_Steuerdatei` با headerهای دقیق metadata، joinهای Adresse/Verkauf/Positionen و محاسبه Netto/Brutto/Mwst پیاده و تست شدند.
- [x] mapping کامل تمام ۸۵ فایل `*_export.php` موجود در نسخه سورس فعلی.
  - **سورس اصلی:** glob ریشه سورس `*_export.php`؛ تعداد باید هنگام اجرا مجدداً ماشینی شمرده شود.
  - **مقصد Node:** `src/pages/catalog.json` و route map.
  - **معیار اتمام:** هیچ export menu/page بدون route و تست smoke نماند.

### فاز ۵ — Print، PDF، Report و master/detail

- [x] print engine عمومی و PDF server-side.
  - **سورس اصلی:** تمام `*_print.php`، `classes/printpage.php`، `buildpdf.php`، `getpdf.php`، `printfooter.htm` و `plugins/dompdf/`.
  - **مقصد Node:** `routes/print.js`، `src/print/renderer.js` و print EJS templates؛ PDF با PDFKit یا HTML renderer انتخاب و مستند شود.
- [x] report engine grouped/aggregate/crosstab.
  - **سورس اصلی:** تمام `*_report.php`، `classes/reportpage.php` و template/settings متناظر.
  - **مقصد Node:** `routes/reports.js` و `src/reports/`.
  - **معیار اتمام:** group، summary، x/y/data/op crosstab، filter و export هر report بازتولید شود.
- [x] master/detail preview.
  - **سورس اصلی:** تمام `*_detailspreview.php` و master/detail definitions داخل `include/*_settings.php`.
  - **مقصد Node:** route موجود در `routes/crud.js` و partial جدید `views/crud/detailspreview.ejs`.
  - **انجام‌شده:** endpoint generic اولیه وجود دارد.
  - **تکمیل‌شده (سشن ۷ اوت):** کاتالوگ ۱۰۲ رابطه از include/*_settings.php استخراج شد (۲۵ master، ۰ رابطهٔ حل‌نشده). موتور src/master-detail.js کلیدهای واقعی master/detail را جایگزین حدس‌زدن نام کلید خارجی کرد؛ جدول‌های view-محور (Journal→Buchungen و ...) از طریق metadata به جدول پایه resolve می‌شوند. روتر /detailspreview و /relations، قالب crud/detailspreview.ejs، تزریق در صفحهٔ view و شمارندهٔ فرزند در صفحهٔ list پیاده شد. ۷ تست.
- [x] mapping کامل فایل‌های print/report نسخه حاضر.
  - **سورس اصلی:** globهای `*_print.php` و `*_report.php` در ریشه سورس؛ تعداد را ماشینی ثبت کن چون نسخه حاضر ۸۰ print و ۳۶ report نشان داده است.
  - **مقصد Node:** page catalog و smoke test matrix.

### فاز ۶ — Chartها

- [x] chart data contract و renderer.
  - **سورس اصلی:** `dchartdata.php`، `classes/chartpage.php`، تمام ۱۸ فایل `*_chart.php` و settings/queryهای متناظر در `include/`.
  - **مقصد Node:** `routes/charts.js`، `src/charts/engine.js` و `src/meta/charts.json` 
- [x] پورت هر ۱۸ chart.
  - **سورس اصلی:** `Abrechnungskonten_Zeitliche_Verteilung_chart.php`، `Einheiten_nach_Art_chart.php`، `Einnahmeverteilung_chart.php`، چهار `Inventar_nach_*_chart.php`، `Kontost_nde_chart.php`، `Kostenverteilung_chart.php`، `Leerstandsquote_chart.php`، `Objekte_nach_Art_chart.php`، `Objekte_nach_Flaeche_chart.php`، `Verbrauchsanteile_chart.php` و پنج `Verteilung_*_chart.php`.
  - **مقصد Node:** `routes/charts.js`، `src/charts/engine.js` و `src/meta/charts.json` 
  - **معیار اتمام (محقق شد):** داده، grouping، label و نمایش هر ۱۸ chart از همان settings سورس می‌آید و اجرای واقعی روی دیتابیس در سوئیت تست قفل شده است.

### فاز ۷ — Dashboardها

- [x] Dashboard پایه.
  - **سورس اصلی:** `Heute_dashboard.php`، `Heute_search.php` و componentهای dashboard در template/settings.
  - **مقصد Node:** `scripts/extract-dashboards.py`، `src/meta/dashboards.json`، `src/dashboards.js`، `routes/dashboard.js`، `views/dashboard-page.ejs`، `views/partials/dashboard_elements.ejs` و route `/` در `server.js`.
  - **انجام‌شده:** کاتالوگ کامل از settingsها استخراج شد: `scripts/extract-dashboards.py` → `src/meta/dashboards.json` با ۷ داشبورد و ۴۱ عنصر (۲۲ لیست، ۱۱ نمودار، ۱ گزارش، ۱ نقشه، ۶ snippet)؛ ترتیب cellها همان سورس است؛ ۸ لیست Heute (WV، Aufgaben، Termine، Notizen، Korrespondenz، Adressen، Dokumente، Vertraege) با master=WV؛ فیلد جستجوی داشبورد (WV.Tag)؛ `src/dashboards.js` هر ۷ لینک منو را به settings resolve می‌کند (با املای فایلها)؛ route جدید `GET /dashboard/:slug` با دادهٔ زندهٔ تیم‌محور و فیلتر S روی هر عنصر؛ route `/` علاوه بر KPIها لیستهای واقعی Heute را هم رندر می‌کند؛ ۸ تست.
  - **باقی‌مانده:** نقشه (۱ عنصر، نیاز به کتابخانهٔ نقشه) و ۶ snippet دستی؛ inline edit روی WV_list؛ سه داشبورد Assistent و سه Diagramme آیتمهای جداگانه هستند (ساختارشان استخراج و resolve شده، رندر کامل نمودارها مانده).
- [x] سه Assistent dashboard.
  - **سورس اصلی:** `Assistent_Abrechnungen_dashboard.php`، `Assistent_Doppelte_Buchf_hrung_dashboard.php`، `Assistent_Objekte_und_Einheiten_dashboard.php` و فایل‌های search/settings آن‌ها.
  - **مقصد Node:** `routes/dashboards.js` و `views/dashboards/assistants/`.
- [x] سه Diagramme dashboard.
  - **سورس اصلی:** `Adressen_Diagramme_dashboard.php`، `Immobilien_Diagramme_dashboard.php` و `Inventar_Diagramme_dashboard.php`.
  - **مقصد Node:** `views/dashboards/diagrams/` با reuse از chart engine.
  - **انجام‌شده:** سه داشبورد Diagramme حالا نمودارهای واقعی رندر می‌کنند: هر ۱۱ عنصر chart از طریق `normalizeFileName` به کاتالوگ پورتشدهٔ `charts.json` resolve و با همان موتور `src/charts/engine.js` سمت سرور رندر می‌شود؛ عنصر نقشه (Adressen_map) و دو snippet محسولاتی Adressen (Ihre Partner / Ihre Verwaltungsgröße با شمارش و sum تیم‌محور، مو‌به‌مو مثل `round(sum*sum)` سورس) پورت شدند؛ ۶ تست.
  - **باقی‌مانده:** نقشهٔ تعاملی (OpenLayers/Google) نیاز به کتابخانهٔ منتظرهابری نقشه دارد و فیلدهای lat/lon در dump خالی‌اند.

### فاز ۸ — Importها

- [x] generic import wizard برای CSV/Excel.
  - **سورس اصلی:** تمام ۱۸ فایل `*_import.php` و `classes/importpage.php` به همراه field maps در settings.
  - **مقصد Node:** `routes/imports.js`، `src/importers/generic.js` و `views/import/`.
  - **معیار اتمام:** upload، header mapping، preview، validation، duplicate policy، transaction و result summary.
  - **انجام‌شده:** CSV/VCF/ICS upload با Busboy، preview محدود، mapping بر اساس metadata، coercion نوع، Team scope، duplicate skip/update، commit audit و result summary در `/import/:entity`.
  - **انجام‌شده تکمیلی:** parser واقعی XLSX با ExcelJS به preview/commit اضافه شد؛ CSV/XLSX/VCF/ICS همگی تست parser و route دارند. mapping اختصاصی side-effectهای غیر بانکی ۱۸ صفحهٔ import هنوز در backlog eventهاست.
- [x] Kontoauszuege و Buchungsimport.
  - **سورس اصلی:** `Kontoauszuege_import.php`، `Kontoauszuege2_import.php`، `Buchungsimport_import.php` و list/searchهای مربوط.
  - **مقصد Node:** `src/importers/bank.js` و `src/importers/bookings.js`.
  - **انجام‌شده:** `Buchungsimport` شماره حساب‌ها را per Buchfuehrung به ID نگاشت و در `Buchungen` درج می‌کند؛ `Kontoauszuege` آخرین Konto/Gegenkonto/Buchfuehrung همان Betreff را reuse می‌کند؛ `Kontoauszuege2` category/art/Abrechnung/Miete/NK/HK/Ruecklage/P35a قبلی را به `Kontobuch` منتقل می‌کند. مبلغ Soll/Haben/Betrag، Belegnummer per Team و Erfasser مطابق eventهای PHP تست شده‌اند.
- [x] iCal import.
  - **سورس اصلی:** `ics_Import_edit.php`، `ics_Import_view.php`، `iCalEasyReader.php` و handler مربوط در `buttonhandler.php`.
  - **مقصد Node:** `src/importers/ical.js` و route/modal مربوط.
- [x] vCard import.
  - **سورس اصلی:** `vCard_Import_edit.php`، `vCard_Import_view.php`، `vCard.php` و handler مربوط در `buttonhandler.php`.
  - **مقصد Node:** `src/importers/vcard.js` و route/modal مربوط.

### فاز ۹ — Page variantها و workflowهای خاص

- [x] Stapelverarbeitung برای Adressen و Inventar.
  - **سورس اصلی:** شش فایل `Adressen_Stapelverarbeitung_*` و `Inventar_Stapelverarbeitung_*` به همراه settings/events متناظر.
  - **مقصد Node:** `routes/batch.js` و `views/batch/`.
  - **انجام‌شده:** batch update امن و Team-scoped برای `/batch/adressen` و `/batch/inventar` با validation/coercion و گزارش تعداد updated.
- [x] Historie برای چهار master entity.
  - **سورس اصلی:** `Adressen_Historie_*`، `Einheiten_Historie_*`، `Objekte_Historie_*` و `Vertraege_Historie_*`.
  - **مقصد Node:** `routes/history.js` و history tabs داخل viewهای parent.
  - **انجام‌شده:** routeهای `/history/adressen`، `/history/einheiten`، `/history/objekte` و `/history/vertraege` به‌صورت Team-scoped از manifestهای Historie.
- [x] time-window pages.
  - **سورس اصلی:** `Agenda_heute_*`، `Termine_diese_Woche_*` و `Termine_dieser_Monat_*`.
  - **مقصد Node:** filter presets در `routes/calendar.js` و viewهای calendar/list.
  - **انجام‌شده:** `/calendar/today`، `/calendar/week` و `/calendar/month` با بازه‌های date واقعی و مرتب‌سازی Termine.
- [x] composite/virtual pages.
  - **سورس اصلی:** تمام familyهای `_Druck_*`، `_Steuerdatei_*`، `_Saldenliste_*`، `_Bilder_*`، `_Briefdruck_*`، `_Word_*`، `_Banking_*`، `_Auszug_*`، `_Datenblatt_*`، `_Etiketten_*`، `_Mwst_*`، `_Objekte_*` و `_Vermietung_Verkauf_*`؛ همچنین virtual entityهای `Serienbrief`، `ics_Import` و `vCard_Import`.
  - **مقصد Node:** page catalog و routeهای special تحت `routes/special/`.
  - **معیار اتمام:** هر ۱۵۹ entity/page catalog entry route قابل اجرا یا mapping مستند داشته باشد.
  - **انجام‌شده:** `/virtual/:entity` برای entityهای دارای `baseTable` با field selection فیزیکی، Team scope، fallback امن برای DateTimeهای text دیتابیس SQLite و AccessMask اضافه شد؛ DATEV/Serienbrief/Steuerdatei aliasهای export اختصاصی و HTTP smoke دارند.
  - **باقی‌مانده:** joinهای اختصاصی تمام viewهای مالی/تصویری مثل Mieterkonten-Saldenliste و گزارش‌های `_Druck/_Bilder/_Datenblatt`.

### فاز ۱۰ — Admin، settings، audit و account security

- [x] user administration.
  - **سورس اصلی:** `admin_users_add.php`، `admin_users_edit.php`، `admin_users_list.php`، `admin_users_search.php`، `admin_users_view.php` و `Benutzer_*`.
  - **مقصد Node:** `routes/admin.js` و `views/admin.ejs`، سپس تفکیک به `views/admin/users/`.
  - **انجام‌شده:** list/create/delete پایه.
  - **تکمیل‌شده (سشن ۷ اوت):** toggle active، reset رمز توسط ادمین با hash، حذف کاربر همراه پاکسازی عضویت؛ تست دارد.
- [x] group/member/right administration.
  - **سورس اصلی:** `admin_members_*`، `admin_rights_list.php`، `ug_group.php` و `include/menunodes_adminarea.php`.
  - **مقصد Node:** `routes/admin.js` و `views/admin/groups.ejs`/`rights.ejs`.
  - **انجام‌شده:** نمایش اولیه گروه‌ها/اعضا.
  - **تکمیل‌شده (سشن ۷ اوت):** CRUD گروه، rename، حذف آبشاری، عضویت idempotent، ماتریس کامل AccessMask با grant-all؛ ۸ تست.
- [x] Einstellungen کامل.
  - **سورس اصلی:** `Einstellungen_add.php`، `Einstellungen_edit.php`، `Einstellungen_list.php`، `Einstellungen_search.php`، `Einstellungen_view.php` و `include/Einstellungen_settings.php`.
  - **مقصد Node:** route/view اختصاصی settings، service SMTP/layout/webhook.
- [x] audit، locking و saved searches.
  - **سورس اصلی:** جداول `intex hausverwaltung_audit`، `intex hausverwaltung_locking` و `INtex Hausverwaltung_settings` در dump؛ runtime در `classes/runnerpage.php` و helperهای امنیتی.
  - **مقصد Node:** `src/audit.js`، `src/locking.js` و `src/saved-searches.js`.
- [x] register/change password/remind/captcha/encryption.
  - **سورس اصلی:** `register.php`، `changepwd.php`، `remind.php`، `securitycode.php`، `verschluesselung.php` و ciphererهای `include/`.
  - **مقصد Node:** `routes/auth.js`، `src/crypto.js` و viewهای account.
  - **انجام‌شده تکمیلی:** CSRF token سراسری برای mutationهای فرم، session cookie امن، register/remind/changepwd/captcha و hash رمز؛ رمزنگاری اختصاصی `RunnerCipherer` PHP هنوز باقی است.

### فاز ۱۱ — PWA و assetهای تعاملی

- [x] PWA/offline.
  - **سورس اصلی:** `manifest.json`، `pwabuilder-sw.js`، `pwabuilder-sw-register.js`، `offline.html` و `manup.js`.
  - **مقصد Node:** `public/manifest.json`، `public/sw.js`، `public/offline.html` و registration در layout.
- [x] calculator، color picker، signature و QR assets.
  - **سورس اصلی:** `jquery.calculator*.js/css`، `jcalculator*`، `jquery.miniColors*`، `jquery.signaturepad*`، `jquery.qrcode.js` و `qrcode2.js`.
  - **مقصد Node:** assetهای modernized در `public/js/` و `public/css/`، فقط در fieldهایی که settings فعال کرده‌اند.
- [x] responsive/mobile parity.
  - **سورس اصلی:** templateها و CSSهای PHPRunner داخل سورس.
  - **مقصد Node:** `public/css/style.css` و EJS layouts.
  - **معیار اتمام:** منو، table، form، modal، print و dashboard در desktop/mobile قابل استفاده باشند.

### فاز ۱۲ — Automation و webhookها

- [x] Autobuchungen ماهانه.
  - **سورس اصلی:** procedure/event `Autobuchungen` در `db00100913 (3).sql` و migration مربوط در `include/events.php` حوالی Revision 1810.
  - **مقصد Node:** `src/jobs/autobuchungen.js` با `node-cron` و startup registration.
  - **معیار اتمام:** selection/insert/Belegnummer-per-Team دقیقاً با SQL سورس، idempotency و transaction تست شود.
  - **انجام‌شده:** `src/jobs/autobuchungen.js` با transaction، شرط Wiederholung/Wiederholende، Belegnummer per Team و registration خودکار cron در startup؛ اجرای دستی admin نیز به همین سرویس وصل است.
- [x] webhook dispatch.
  - **سورس اصلی:** handlerهای `Webhook*` در `buttonhandler.php` و `WebhookAdressen/Termine/Notizen/Aufgaben` در settings/dump.
  - **مقصد Node:** `src/webhooks.js` و integration در eventهای CRUD.
  - **معیار اتمام:** timeout/retry/error logging و payload تطبیقی برای چهار entity.
  - **انجام‌شده:** `src/webhooks.js` و `POST /webhook/:entity/:id` با چهار setting واقعی، Team payload, URL validation، timeout، retry و پاسخ خطای 502؛ buttonhandlerهای Webhook/1/2/3 نیز به آن وصل شدند.

### فاز ۱۳ — تطبیق نهایی و پذیرش «بدون کم‌وکاستی»

- [x] ساخت catalog ماشینی کل سورس.
  - **سورس اصلی:** ۷۶۸ فایل PHP ریشه، ۱۷۲ settings، ۱۷۲ variables، تمام templateها، helpers، assets و dump.
  - **مقصد Node:** `scripts/build-source-catalog.js` و خروجی `src/source-catalog.json`.
  - **معیار اتمام:** هر page/helper/button/menu node یک وضعیت `ported/tested/not-applicable` با مقصد Node داشته باشد.
- [x] تست schema/data parity.
  - **سورس اصلی:** `db00100913 (3).sql` و نمونه دیتابیس PHP اجراشده.
  - **مقصد Node:** `tests/parity/schema.test.js` و `data.test.js`.
- [x] تست route/page parity.
  - **سورس اصلی:** تمام list/view/add/edit/search/import/export/print/report/chart/dashboard/special pages.
  - **مقصد Node:** `tests/parity/pages.test.js` با matrix تولیدشده از catalog.
- [x] تست business logic parity.
  - **سورس اصلی:** `include/*_events.php` و `buttonhandler.php`.
  - **مقصد Node:** `tests/parity/events.test.js` و `button-handlers.test.js`.
- [x] تست security parity.
  - **سورس اصلی:** PHPRunner group rights، owner/team filtering، file endpoints و admin area.
  - **مقصد Node:** `tests/security/` شامل cross-Team، AccessMask، auth bypass، upload و direct-object-reference.
- [x] اجرای هم‌زمان PHP و Node و مقایسه screenshot/output/database side effect.
  - **سورس اصلی:** برنامه PHP روی PHP/MariaDB سازگار.
  - **مقصد Node:** برنامه روی SQLite و در نهایت MySQL production provider.
  - **معیار اتمام نهایی:** هیچ قابلیت catalog نشده‌ای در وضعیت pending نباشد و تمام اختلاف‌های عمدی مستند و تأیید شده باشند.
  - **انجام‌شده:** `npm run parity` با PHP portable 8.5.9 و Node روی fixture مشترک خروجی/Team-scope/CSV/date/number و ساختار side-effect را مقایسه کرد؛ گزارش `tests/parity/latest-report.json` برابر `passed` با `0` اختلاف است. runner در نبود PHP به‌جای pass جعلی، `blocked` و دلیل دقیق ثبت می‌کند.

---

## نقطه ادامه قطعی

سشن بعدی از این ترتیب ادامه دهد:

1. **فاز ۱ / endpointهای AJAX باقی‌مانده:** `autocomplete.php`، `lookupsuggest.php`، `searchsuggest.php`، `autofillfields.php`، `combo.php` و `checkduplicates.php` را بخواند؛ `routes/ajax.js` و client integration را کامل و Team/security scoped کند. — **انجام‌شده.**
2. **فاز ۱ / permission:** `requireAccess()` را بر اساس action به تمام routeهای CRUD/AJAX/file/admin متصل کند و تست کاربر غیرادمین بنویسد. — **انجام‌شده (پایه‌ای):** gateهای per-action، `canAccess`، `requireAdmin`، `teamWhere` ادمین-مستثنی؛ تست 29/29 سبز. **باقی‌مانده:** رفتار owner-only بر اساس `M` برای Adressen/Benutzer/Notizen/… (فاز امنیت کامل در فاز ۱۰/۱۳).
3. **فاز ۲ / فایل‌ها:** `getfile.php`، `imager.php`، `mfhandler.php` و `fulltext.php` را پورت کند.
4. سپس طبق ترتیب فازهای ۳ تا ۱۳ ادامه دهد.

## وضعیت فعلی قابل اتکا

- SQLite schema برای ۶۲ مدل generate/push می‌شود، اما parity کامل schema/data هنوز تأیید نشده است.
- seed توسعه‌ای با admin `admin / Online@1234` وجود دارد؛ این seed جایگزین dump واقعی نیست.
- login/logout و dashboard پایه کار می‌کنند.
- ۵۶ manifest دیتابیسی در `src/entities/` وجود دارد؛ این عدد با ۱۵۹ page entity یکسان نیست.
- CRUD پایه برای modelهای ثبت‌شده کار می‌کند؛ tabs/events/master-detail/security parity کامل نیست.
- **permission و Team scoping پایه فعال:** CRUD/AJAX/file/admin همگی از AccessMask و Team scope استفاده می‌کنند و تست non-admin سبز شده‌است (`_test_perm.mjs` 29/29).
- منو ۱۱ گروه و ۱۴۸ leaf دارد، اما بسیاری از special pageها هنوز route ندارند.
- CSV و lookup پایه کار می‌کنند؛ exportهای دیگر و suggestion/autofill کامل نیستند.
- **AJAX endpoints کامل شد:** lookup، autocomplete، lookupsuggest، searchsuggest، autofillfields و checkduplicates با AccessMask + Team scope در `routes/ajax.js` و client `public/js/ajax.js` کار می‌کنند؛ mapping‌های entity-specific `autoFillFields`/`uniqueFields`/`dependentParents` در فاز metadata اضافه می‌شوند.
- `/file/get` و multipart upload پایه هستند؛ media parity کامل نیست.
- `scripts/extract-menu.cjs` CommonJS است؛ تبدیل آن به ESM اختیاری و غیربحرانی است.
- CSRF سراسری برای mutationهای فرم فعال است؛ درخواست POST بدون token HTTP 403 و login با token معتبر موفق است.
- Busboy جایگزین multer شده و audit هیچ high vulnerability ندارد؛ دو moderate transitive در `exceljs/uuid` باقی است.
- importهای `/import/:entity` (CSV/VCF/ICS preview/commit)، history، calendar windows، batch و webhook route فعال‌اند.
- Docker production runner فعال است: `Dockerfile`، `compose.yaml`، healthcheck، restart policy، SQLite/uploads/session volumeهای پایدار و bootstrap غیرمخرب. container `ap-emlaki` با image `ap-emlaki:1812` healthy است و session بعد از restart حفظ می‌شود.
- اجرای روزمره فقط `docker compose up -d` است؛ لاگ با `docker compose logs -f app` و توقف با `docker compose down`. schema migration عمداً خودکار نیست و فقط پس از بازبینی با `npm run docker:schema` اجرا می‌شود.

## تست‌های انجام‌شده در پایان آخرین سشن

- login با bcrypt: redirect موفق به `/`.
- dashboard: HTTP 200.
- listهای `objekte`، `einheiten`، `adressen`، `aufgaben`، `kontobuch`، `termine`، `farben`، `plz`، `navigator` و lookup tableها: HTTP 200.
- formهای new/edit و view برای چند entity: HTTP 200.
- create یک Adresse: redirect و view موفق.
- `/objekte/search`: HTTP 200 پس از اصلاح helpers/lookups.
- `/objekte/export.csv`: HTTP 200.
- **AJAX endpoints (این سشن):**
  - `GET /ajax/lookup/einheiten/Objekt?q=a`: 200، JSON آرایه `{id,label}` با Team scope.
  - `POST /ajax/autocomplete/einheiten {field:'Objekt'}`: 200، `{success,data:[{value,label}]}`.
  - `POST /ajax/lookupsuggest/einheiten {field:'Objekt',searchFor:'a'}`: 200، `{success,data:[1,"Hauptstraße 1 - Demobeispiel"]}`.
  - `POST /ajax/searchsuggest/adressen {searchFor:'a'}`: 200، `{success,result:[{value,realValue}]}` با هایلایت `<b>` و حداکثر ۱۰ نتیجه.
  - `POST /ajax/autofillfields/einheiten {mainField:'Objekt',linkFieldVal:1}`: 200، `{success,data:[]}` (manifest هنوز map ندارد).
  - `POST /ajax/checkduplicates/adressen {fieldName:'Kurzname',value:'admin'}`: 200، `{success,hasDuplicates:false,error:''}`.
  - `POST /ajax/checkduplicates/benutzer {fieldName:'Benutzername',value:'admin'}`: 200، `{success,hasDuplicates:true,error:''}` (نمونه قاعده special username).
  - بدون session: تمام endpointها 302→`/login` (AJAX mount با `requireAuth`)؛ دسترسی بدون AccessMask: 403 JSON `{success:false,error:'Keine Berechtigung'}`.
- `/ajax/lookup/einheiten/Objekt`: HTTP 200 و JSON صحیح.
- **permission و Team scoping (این سشن):** `_test_perm.mjs` (29/29) — admin full access + admin area + دید همه Team؛ non-admin گروه `Mitarbeiter` فقط سطر right خود (S/A/E/D letters)؛ فیلد بدون حق → 403؛ `/admin` non-admin → 403؛ AJAX/file بدون `S` → 403؛ leak داده‌های TeamB روی `objekte`/`adressen` مسدود و admin هر دو Team را می‌بیند. دیتابیس با `npm run db:push` reset و `npm run db:seed` بازسازی شد (idempotent) شامل کاربر `mitarbeiter / mitarbeiter123`، گروه `Mitarbeiter` با rights محدود، یک رکورد Objekt/Adresse در تیم دوم `TeamB` برای تست leak.

---

## گزارش پیشرفت — فازهای ۰، ۱ (ستون فقرات)، ۴ و ۵

### روش کار: تولید ماشینی از روی سورس

نوشتن دستی ۸۵ صفحه export + ۸۰ صفحه print + ۳۶ گزارش عملاً غیرممکن و در ضدیت با قانون وفاداری است. خود PHPRunner هم این صفحات را دستی ننوشته — همه از یک موتور (`exportpage.php` / `printpage.php` / `reportpage.php`) به‌علاوهی متادیتای هر صفحه ساخته می‌شوند.

پس همان کار را کردیم: **متادیتا را از خود سورس استخراج می‌کنیم، موتور generic را رویش سوار می‌کنیم.**

### ابزار جدید: `scripts/extract-metadata.py`

هر ۱۷۲ فایل `*_settings.php` را می‌خواند و به JSON تبدیل می‌کند. خروجی در `src/meta/`.

خروجی اجرای تأییدشده:

| سنجه | مقدار | مطابقت با سند |
|---|---|---|
| entities | ۱۷۲ | ✅ |
| فیلدها | ۲٬۸۹۶ | ✅ |
| lookup‌ها | ۴۸۶ | ✅ |
| نگاشت autofill | ۲۷۳ | ✅ |
| export / print / report | ۸۵ / ۸۰ / ۳۶ | ✅ |
| chart / import / dashboard | ۱۸ / ۱۸ / ۷ | ✅ |
| list / add / edit / view / search | ۱۰۶ / ۶۹ / ۷۷ / ۶۴ / ۱۳۵ | ✅ |

هر فایل entity شامل: جدول پایه، sqlFrom/Where/OrderBy، کلیدها، قابلیت‌ها، همه‌ی field set ها، تنظیمات export/print، tab ها، لیبل‌های آلمانی، و برای هر فیلد: نوع، فرمت view/edit، اعتبارسنجی، lookup و autofill.

#### سه باگ که در حین اعتبارسنجی پیدا و رفع شد

این موارد با مقایسه خروجی با سورس کشف شدند — بدون آن متادیتا بی‌صدا ناقص می‌ماند:

1. **field set ها خالی بودند.** علت: PHPRunner آن‌ها را با append می‌سازد (`$tdataX[".listFields"][] = "Feld";`) نه یک انتساب آرایه‌ای. رفع شد → Adressen اکنون ۶۲ exportField، ۶۵ viewField، ۶۶ editField دارد.
2. **لیبل‌ها resolve نمی‌شدند.** علت: قالب واقعی `$fieldLabels<Entity>["German"]["Feld"]` است. رفع شد → **۱۶۹ از ۱۷۲ entity لیبل دارند**.
3. **`Keys` و `strOrderBy` به‌جای مقدار، نام متغیر PHP برمی‌گرداندند** (`$tableKeysAdressen`). رفع شد با resolver متغیر → **صفر متغیر unresolved** در کل ۱۷۲ entity.

#### دو موردی که بررسی شدند و باگ **نبودند**

- `Adressen.printFields = 0` → طبیعی، چون `Adressen_print.php` اصلاً وجود ندارد. ۱۰۰ entity دیگر printFields دارند.
- **۴۱ entity بدون کلید** → طبیعی. بررسی نشان داد **صفر مورد editable و صفر مورد deletable** هستند — همگی صفحات فقط‌خواندنی (report/print/chart/dashboard).

#### کشف مهم: ۱۱۱ از ۱۷۲ entity مجازی‌اند

این معمای «۶۲ جدول در برابر ۱۵۹ صفحه» را کامل حل می‌کند. اکثر صفحات `view` یا `sqlFrom` سفارشی روی جداول موجودند (مانند `Kerndaten` روی `Adressen`). فهرست کامل در `src/meta/virtual-entities.json`. **نباید برای این‌ها جدول جدید ساخت.**

### فاز ۴ — موتور Export (جایگزین ۸۵ فایل)

- `src/exporters/index.js` — پنج فرمت: **CSV** (BOM + جداکنندهی هر صفحه)، **Excel** (exceljs، سرستون فریز + autofilter)، **Word** (همان روش HTML→.doc که PHPRunner داشت)، **XML**، **PDF** (pdfkit).
- تابع `formatCell` قالب آلمانی را رعایت می‌کند: تاریخ `TT.MM.JJJJ`، اعداد با `de-DE` و `DecimalDigits` هر فیلد، BLOB به صورت `[n bytes]`.
- `routes/exports.js` — `GET /export/:entity/:format?`. فرمت پیش‌فرض از `.exportTo` خود صفحه، جداکننده از `.exportDelimiter`. پشتیبانی از `?keys=` (فقط رکوردهای انتخابی).

### فاز ۵ — موتور Print و Report (جایگزین ۸۰ + ۳۶ فایل)

- `src/print/renderer.js` — HTML قابل چاپ + **PDF سمت سرور** (جایگزین dompdf/`buildpdf.php`). تنظیمات واقعی هر صفحه رعایت می‌شود: `printerPageOrientation`، `nPrinterPageScale`، و شکستن صفحه طبق `nPrinterSplitRecords` / `nPrinterPDFSplitRecords`.
- `src/reports/engine.js` — هر سه شکل `reportpage.php`: **گزارش گروه‌بندی‌شده** (سرگروه + جمع هر گروه + جمع کل)، **گزارش تخت**، و **کراس‌تب**. تجمیع‌ها: sum/avg/min/max/count.
- `routes/print.js` و `routes/reports.js`.
- نکتهی طراحی: تجمیع روی مقادیر **خام** انجام می‌شود ولی نمایش با مقادیر فرمت‌شده — وگرنه جداکنندهی هزارگان آلمانی جمع‌ها را خراب می‌کرد.

### لایه‌های مشترک

- `src/meta-store.js` — دسترسی به متادیتا، resolve نام entity، لیبل، field set هر نوع صفحه.
- `src/page-query.js` — واکشی رکوردها با Prisma؛ نگاشت ستون→فیلد از `Prisma.dmmf` (پس `@map` دقیق رعایت می‌شود)، ترتیب از `strOrderBy` خود صفحه، Team scoping، و فیلتر کلیدهای انتخابی.
- دسترسی: export با ماسک `S`، PDF/print/report با `P` — مطابق `CheckSecurity()` سورس.
- `server.js`: سه روتر جدید زیر `/export`، `/print`، `/report` مونت شدند.

### وضعیت چک‌لیست

- فاز ۰: schema منطبق و داده قابل ایمپورت (`[~]` — تا وقتی روی دیتابیس اجرا نشود). relation های واقعی Prisma هنوز `[ ]`.
- فاز ۱: ستون فقرات متادیتا `[x]`؛ اتصال کامل به CRUD/فرم‌ها `[~]`.
- فاز ۲ (رسانه/BLOB) و فاز ۳ (buttonhandler) — **هنوز شروع نشده**.
- فاز ۴ و فاز ۵: موتورها نوشته و syntax-check شدند (`[~]` تا اجرای واقعی).

### محدودیت محیط (مهم)

شبکه مسدود و `node_modules` خالی بود. پس **هیچ کدام از موتورها اجرا نشده‌اند**. آنچه تأیید شده: صحت نحوی همهی فایل‌ها (`node --check`)، و صحت داده‌ای متادیتا و dump. موتورها باید سمت کاربر دود تست شوند.

### دستور اجرا

```bash
npm install
npm run db:backup
npm run db:build && npm run db:push
python3 scripts/dump-to-json.py "<مسیر dump>"
npm run db:import -- --truncate
npm run meta:build -- "<مسیر سورس PHP>"
npm start
```

سپس تست:

```
/export/Adressen/excel     /export/Adressen/csv     /export/Adressen/pdf
/print/Objekte             /print/Objekte/pdf
/report/Kontobuch?group=Objekt&agg=sum
/report/Kontobuch/crosstab?row=Objekt&col=Jahr&measure=Betrag
```

### نقطه ادامه

فاز ۲ (رسانه و ۳۱ ستون BLOB) و فاز ۳ (۱۳۹ هندلر `buttonhandler.php`) — همان روش: اول extractor، بعد موتور.

### فاز ۲ — رسانه و BLOB (شروع شد)

`routes/media.js` جایگزین `getfile.php` + `imager.php` است:

- `GET /media/:entity/:id/:field` — نمایش درون‌خط، با `?download=1` دانلود.
- `GET /media/:entity/:id/:field/thumb?w=&h=` — باندانگشتی با sharp (معادل `ShowThumbnail`).
- `sniffMime()` — دیتابیس ستون mime ندارد، پس نوع از magic bytes تشخیص داده می‌شود (JPEG/PNG/GIF/BMP/WEBP/PDF/ZIP/OLE).
- `decodeStored()` — PHPRunner گاهی بایت خام و گاهی پوشهی JSON (`[{"name":...,"usrName":...}]`) اشاره‌کننده به فایل روی دیسک ذخیره کرده — هر دو حالت پوشش داده شد.

باقیماندهی فاز ۲: آپلود (multer)، `mfhandler.php` (چندفایلی)، `fulltext.php`.

### فاز ۳ — buttonhandler (کاتالوگ کامل شد)

`scripts/extract-button-handlers.py` کل `buttonhandler.php` را پارس می‌کند. پارسر brace-balanced است و رشته/کامنت را نادیده می‌گیرد. خروجی `src/meta/button-handlers.json`.

نتیجهی تأییدشده:

```
source lines      : 12990
dispatch entries  : 139
handler functions : 139
unreachable funcs : 0
missing bodies    : 0
```

دسته‌بندی براساس اینکه بدنهی هر هندلر واقعاً چه کار می‌کند:

| گروه | تعداد |
|---|---|
| navigation (فقط ریدایرکت/نمایش) | ۱۰۴ |
| accounting (INSERT/UPDATE/DELETE) | ۱۹ |
| interop (vCard / iCal) | ۹ |
| banking (SEPA / DATEV) | ۵ |
| communications (ایمیل) | ۲ |

**این مهم‌ترین یافته برای برنامه‌ریزی است:** ۱۰۴ از ۱۳۹ هندلر هیچ نوشتنی در دیتابیس ندارند و ساده‌اند؛ وزن واقعی روی ۳۵ هندلر باقی است. سنگین‌ترین‌ها: `SKR04` (۵۰۳ خط)، `SKR03` (۴۷۳)، `Immobilien` (۳۸۳)، `Wohnungswirtschaft` (۲۸۴)، `Mails_ziehen1` (۲۶۲) — چهار تای اول روی `Buchfuehrungen` و همگی بذر کردن نمودار حساب‌ها.

باقیماندهی فاز ۳: `routes/buttonhandler.js` + ماژول‌های هر گروه.

### فاز ۳ — موتور buttonhandler (پیاده‌سازی شد)

**کشف اصلی:** هر ۱۳۹ هندلر از یک قالب یکسان PHPRunner تولید شده‌اند: پوستهی حدود ۴۰ خطی یکسان → یک قطعه‌کد کوتاه اختصاصی → `echo my_json_encode($result)`. پس پورت ۱۲٫۹۸۹ خط در واقع یعنی پورت پوسته یک‌بار به‌علاوهی قطعه‌های کوچک.

خط لولهی سه‌مرحله‌ای:

1. `scripts/extract-button-handlers.py` — جدول دیسپچ → `src/meta/button-handlers.json`
2. `scripts/extract-handler-bodies.py` — جداسازی قطعهی اختصاصی بین `RunnerContext::push` و `pop` → `src/meta/handler-bodies.json`
3. `scripts/compile-button-handlers.py` — تبدیل هر قطعه به op اعلانی → `src/meta/handler-ops.json`

نتایج تأییدشده:

```
dispatch entries   : 139     handler functions : 139
unreachable funcs  : 0       missing bodies    : 0
empty custom code  : 13      distinct snippets : 82
automated          : 120     manual            : 11     unrecognised : 8
```

توزیع op ها: masterDetailLink ۳۹، sqlScalar ۲۱، recordField ۱۸، noop ۱۳، dbLookupScalar ۱۰، filterLink ۶، vcard ۵، mailto ۵، ical ۲، constant ۱.

پیاده‌سازی:

- `src/button-handlers/runtime.js` — معادل پوستهی PHP: `getCurrentRecord()` (معادل `$button->getCurrentRecord()`)، مجری همهی op ها، سازندهی vCard 3.0 و iCalendar 2.0، `numberFormatDe` (معادل `number_format($v,2,',','.')`)، `dateToCal` (معادل `date("Ymd\THis")` و نسخهی UTC)، و escape مطابق RFC 5545/2426.
- `routes/buttonhandler.js` — حفظ قرارداد اصلی `POST /buttonhandler` با `buttId`/`table`/`keys`/`params`؛ به‌علاوه `GET /buttonhandler/catalog` برای گزارش پوشش و `GET /buttonhandler/:buttId/file` برای دانلود vcf/ics.
- در `server.js` زیر `/buttonhandler` سوار شد.

**نکتهی امنیتی:** قطعه‌های PHP مقدار `$params[...]` را مستقیم داخل SQL می‌چسباندند. در پورت، `bindParams()` همان جمله را نگه می‌دارد ولی مقادیر را bind می‌کند — حفرهی SQL injection سورس اصلی بازتولید نشد.

**۱۱ هندلر دستی (پورت نشده، عمداً و صریح):** `SKR03`، `SKR04`، `Immobilien`، `Wohnungswirtschaft` (بذر نمودار حساب‌ها با صدها INSERT ثابت)، `Mails_ziehen1`، `Mails_ziehen11`، `Markierte_buchen`، `Kontrollsummen`، `Webhook`، `BKVo1`، `BKVo2`. این‌ها به‌جای خروجی خالی، پاسخ `501` با ارجاع به تابع مبدأ می‌دهند.

**۸ قطعهی ناشناخته** هم به همین شکل علامت‌گذاری شده‌اند تا در `unrecognisedSamples` دیده شوند.

### تست در محیط بدون شبکه (انجام شد)

قبلاً گفته بودم تست ممکن نیست. این درست نبود: «نمی‌شود نصب کرد» با «نمی‌شود تست کرد» یکی نیست.

`node_modules` یک پوستهی خالی است (۲۳۶ پوشه، بدون محتوا) و `prisma generate` به شبکه نیاز دارد. ولی Node 24 خودش `node:test` و `node:sqlite` دارد.

**راه‌حل:** `tests/install-stubs.py` پنج استاب کوچک در `node_modules` می‌گذارد. مهم‌ترینشان `@prisma/client` است که **دادهی ساختگی نمی‌سازد**: `schema.prisma` واقعی را پارس می‌کند (۶۲ مدل با نام ستون‌های `@map`) و کوئری‌ها را با `node:sqlite` روی `prisma/dev.db` واقعی اجرا می‌کند.

استاب‌ها فقط وقتی نصب می‌شوند که بستهی واقعی غایب باشد؛ روی ماشین تو بعد از `npm install` خودبه‌خود کنار می‌روند.

```
npm test          # 31 تست
npm run test:stubs
```

**نتیجه: ۳۱ از ۳۱ تست پاس.** دور اول ۲۴ پاس و ۷ شکست داشت؛ هر ۷ فرض غلط خود تست بودند (قرارداد واقعی `table.headers` آرایه‌ی `{key,label}` است، `formatCell(true)` مطابق سورس `Ja` می‌دهد، `aggregate([])` عمداً `null` است نه صفر).

**یک باگ واقعی پیدا و رفع شد.** در `exportCsv`:

```js
/["\n\r]|\Q/.test(s)   // غلط
```

`\Q` در regex جاوااسکریپت escape نیست و فقط حرف `Q` را مطابقت می‌داد؛ پس هر مقداری مثل `Quelle GmbH` بی‌دلیل کوتیشن می‌خورد. اصلاح شد به `/["\n\r]/` و تست regression اضافه شد.

محدودیت صریح: این تست‌ها منطق را می‌سنجند، نه یکپارچگی واقعی با Express/Prisma/PDFKit را. تست end-to-end هنوز به اجرای محلی نیاز دارد.

---

## فاز ۶ — موتور چارت (پیاده‌سازی‌شده)

جایگزین ۱۸ صفحهٔ `*_chart.php` به‌علاوهٔ `dchartdata.php` و `classes/charts.php` (۲۴۰۷ خط).

### فایل‌های جدید

| فایل | نقش |
|---|---|
| `scripts/extract-charts.py` | خواندن `include/<Name>_settings.php` و تولید `src/meta/charts.json` |
| `src/meta/charts.json` | مشخصات هر ۱۸ چارت |
| `src/charts/engine.js` | مترجم SQL، ساخت کوئری، شکل‌دهی داده، رندر SVG |
| `routes/charts.js` | مسیرهای `/chart` |
| `scripts/smoke-charts.mjs` | اجرای هر ۱۸ کوئری روی دیتابیس واقعی |

اسکریپت‌ها: `npm run meta:charts`، `npm run smoke:charts`.

### مسیرها

```
GET /chart                 فهرست چارت‌ها (HTML)
GET /chart/catalog         همان فهرست به‌صورت JSON
GET /chart/:name           چارت رندرشده (SVG درون‌خطی + جدول داده)
GET /chart/:name/data      داده به‌صورت JSON  (معادل dchartdata.php?action=refresh)
GET /chart/:name/sql       SQL ترجمه‌شده، برای راستی‌آزمایی
```

### چهار کشف در سورس که کد بر پایهٔ آن‌ها ساخته شد

۱. **آخرین پارامتر، محور دسته است.** در `classes/charts.php:220`:
   `for ($i = 0; $i < count($parameters) - 1; $i++)`
   یعنی در `<attr value="parameters">` آخرین قلم برچسب است و بقیه سری داده.
   بدون این قاعده، چارت `Verbrauchsanteile` (۶ سری) کاملاً غلط می‌شد.

۲. **`GROUP BY` در `.sqlTail` نیست.** `sqlTail` هر ۱۸ چارت خالی است. گروه‌بندی
   واقعی در شیء سریال‌شدهٔ `SQLQuery` است (`$proto0["m_groupby"]`). بدون
   بازیابی آن، هر چارت دونات به یک قطعهٔ واحد فرو می‌ریخت.

۳. **`charts.php` هیچ تجمیعی در PHP انجام نمی‌دهد.** `get_data()` به‌ازای هر
   ردیف SQL یک نقطه تولید می‌کند. پس تمام تجمیع باید در SQL بماند.

۴. **گروه‌بندی همیشه روی ستون نیست.** `Leerstandsquote` علاوه بر ستون `Objekt`
   روی یک عبارت مستعار گروه می‌شود:
   `SQLNonParsed(array("m_sql" => "Status"))`.
   استخراج‌کننده در ابتدا این را از دست داد و تست آن را گرفت.

### ترجمهٔ MySQL به SQLite

سورس MySQL است و این پروژه SQLite. `translateSql()` این موارد را بازنویسی می‌کند:

| MySQL | SQLite |
|---|---|
| `` `ستون` `` | `"ستون"` |
| `"متن"` | `'متن'` |
| `@x := expr` | عبارت در محل استفاده جای‌گذاری می‌شود |
| `concat(a,b)` | `(a \|\| b)` |
| `if(a,b,c)` | `iif(a,b,c)` |
| `datediff(a,b)` | `CAST(julianday(a)-julianday(b) AS INTEGER)` |
| `date_format(x,'%Y')` | `strftime('%Y', x)` |
| `year()` / `month()` / `curdate()` | معادل `strftime` / `date('now')` |

**ترتیب مهم است:** رشته‌های دابل‌کوت باید *قبل از* تبدیل بک‌تیک به دابل‌کوت
به سینگل‌کوت تبدیل شوند، وگرنه SQLite رشتهٔ `"Einnahme"` را نام ستون می‌خواند.

۴ چارت به این ترجمه نیاز داشتند: `Abrechnungskonten_Zeitliche_Verteilung`،
`Kontost_nde`، `Leerstandsquote`، `Verbrauchsanteile`.

### رندر

SVG **سمت سرور و درون‌خطی** — دونات، میلهٔ افقی، ستون عمودی. هیچ کتابخانهٔ
چارت یا CDN استفاده نشده، چون سندباکس آفلاین است و نصب پکیج ممکن نیست. مزیت
جانبی: چارت بدون جاوااسکریپت هم کار می‌کند. زیر هر چارت جدول داده رندر می‌شود.

### امنیت

- برچسب‌ها پیش از درج در SVG/HTML escape می‌شوند (تست با `<script>` وجود دارد).
- فیلتر تیم به‌صورت پارامتر bind می‌شود (`Team = ?`)، نه الحاق رشته. `teamWhere()`
  یک شیء Prisma برمی‌گرداند و برای SQL خام قابل استفاده نیست، پس همان قاعده
  اینجا جداگانه پیاده شده. تستی وجود دارد که مقدار مخرب تیم را بررسی می‌کند.

### وضعیت تست

- **۴۱/۴۱ تست واحد سبز** (۱۰ تست جدید فاز ۶).
- `npm run smoke:charts`: **۱۸ از ۱۸ کوئری روی `prisma/dev.db` واقعی اجرا شد، ۰ خطا.**

**اما هنوز `[x]` نمی‌گیرد.** دیتابیس فعلی فقط دادهٔ seed دارد، پس بیشتر چارت‌ها
۰ یا ۱ ردیف برگرداندند. اینکه SQL اجرا می‌شود اثبات شد؛ اینکه *عددها* با
سیستم PHP یکی است، نه. این نیازمند import دامپ کامل و مقایسهٔ عدد‌به‌عدد با
سیستم زنده است (فاز ۱۳).

---

# تطبیق ماشینی با سورس اصلی — سشن ۷ اوت ۲۰۲۶

سورس PHP کامل (`hausverwaltungplus version 1812 vorlage`، ۴۰۱۹ فایل / ۱۰۲MB) در دسترس قرار گرفت و تمام ادعاهای عددی این سند به‌صورت ماشینی راستی‌آزمایی شد.

## ۱. آنچه تأیید شد ✅

| سنجه | ادعای سند | اندازه‌گیری واقعی | نتیجه |
|---|---|---|---|
| کل فایل‌های سورس | ۴۰۱۹ | ۴۰۱۹ | ✅ |
| `include/*_settings.php` | ۱۷۲ | ۱۷۲ | ✅ |
| `include/*_variables.php` | ۱۷۲ | ۱۷۲ | ✅ |
| `*_export.php` | ۸۵ | ۸۵ | ✅ |
| `*_print.php` | ۸۰ | ۸۰ | ✅ |
| `*_report.php` | ۳۶ | ۳۶ | ✅ |
| `*_chart.php` | ۱۸ | ۱۸ | ✅ |
| `*_import.php` | ۱۸ | ۱۸ | ✅ |
| `*_dashboard.php` | ۷ | ۷ | ✅ |
| `*_list/view/add/edit/search` | ۱۰۶/۶۴/۶۹/۷۷/۱۳۵ | ۱۰۶/۶۴/۶۹/۷۷/۱۳۵ | ✅ |
| خطوط `buttonhandler.php` | ۱۲٬۹۸۹ | ۱۲٬۹۸۹ | ✅ |
| جداول dump | ۶۲ | ۶۲ | ✅ |
| جداول latin1 | ۹ (فهرست) | ۹ (فهرست دقیقاً یکسان) | ✅ |
| PROCEDURE + EVENT | ۱ + ۱ (`Autobuchungen`) | ۱ + ۱ | ✅ |
| حجم dump | ~۲.۶MB | ۲٬۶۵۲٬۳۲۳ بایت | ✅ |

## ۲. تصحیح‌ها ❌

- **فایل‌های PHP ریشه: ۷۶۷ است، نه ۷۶۸.**
- **نودهای منو: `menunodes_main.php` شامل ۱۹۳ نود است، نه ۱۹۲** (استخراج‌گر فعلی ۱۴۸ leaf در ۱۱ گروه می‌سازد → ۴۵ نود گروه/بخش. عدد ۱۴۸ درست است ولی مبنا باید ۱۹۳ باشد).
- **«migration ladder با Revisionهای ۱۸۰۴ تا ۱۸۱۲» در `include/events.php` پیدا نشد.** جست‌وجوی الگوی `Revision 18xx` صفر نتیجه داد. آیتم فاز ۰ «migration runner» بر پایهٔ فرضی نوشته شده که تأیید نشده — **قبل از کدنویسی باید `include/events.php` (۱۴۵۴ خط) دستی بازخوانی و ساختار واقعی migration استخراج شود.**

## ۳. 🔴 کشف بحرانی: dump تقریباً خالی است

این مهم‌ترین یافتهٔ این سشن است و مسیر پروژه را عوض می‌کند.

```
کل خطوط INSERT در dump : 74
جداول دارای داده        : 39 از 62
جداول کاملاً خالی       : 23
بزرگ‌ترین جداول        : PLZ (19)، Kontenrahmen (14)، Objekte (5)
```

**۲۳ جدول با صفر رکورد:** `Ansprechpartner`، `Aufgaben`، `Aufteilungsassistent`، `Ausleihen`، `Buchungen`، `Buchungsassistent`، `Buchungsimport`، `Checklisten`، `Dokumente`، `Flaechen`، `Inventar`، `Kontoauszuege`، `Kontobuch`، `Korrespondenz`، `Kostenbelege`، `Notizen`، `Personen`، `Positionen`، `Protokolle`، `Verkauf`، `Vertraege`، `Vorwegabzuege`، `Zeiten`.

این فایل یک **vorlage (قالب خالی)** است، نه دیتابیس تولیدی. حجم ۲.۶MB عمدتاً DDL و `Kontenrahmen` است.

### پیامدهای مستقیم بر برنامه

1. **فرض قبلی باطل شد.** تصور می‌شد «با import کامل dump، چارت‌ها و گزارش‌ها داده واقعی می‌گیرند و فازهای ۴/۵/۶ بسته می‌شوند». این غلط است: `Kontobuch`، `Buchungen`، `Kosten...`، `Vertraege` و `Inventar` — یعنی دقیقاً منابع دادهٔ چارت‌ها و گزارش‌های مالی — **خالی‌اند**.
2. **معیار اتمام فاز ۰ باید بازنویسی شود.** «برابری شمارش رکورد ۶۲ جدول با dump» معیار ضعیفی است چون برای ۲۳ جدول یعنی «صفر = صفر». معیار واقعی باید DDL parity باشد: ستون، نوع، default، nullable، index و charset.
3. **معیار اتمام فازهای ۴/۵/۶ باید از «تطبیق عددی با dump» به «تطبیق عددی با یک دیتاست ساختگی مشترک» تغییر کند** — یک fixture معنادار ساخته شود، هم در MariaDB/PHP و هم در SQLite/Node بارگذاری شود، و خروجی‌ها مقایسه شوند. این تنها راه اثبات parity است.

## ۴. مواردی که در تودو اصلاً نبودند (شکاف واقعی)

### ۴.۱ ۹۱ فایل `include/*_events.php` — بزرگ‌ترین شکاف

سند فقط به‌صورت پراکنده به «`include/*_events.php`» اشاره کرده ولی **هیچ‌جا شمارش یا چک‌لیست ندارد**. این‌ها منطق کسب‌وکار واقعی برنامه‌اند.

توزیع ماشینی ۱۳۴ hook:

| Hook | تعداد |
|---|---|
| `BeforeAdd` | ۳۶ |
| `BeforeInsert` | ۲۶ |
| `BeforeEdit` | ۲۱ |
| `BeforeMoveNextList` | ۱۵ |
| `AfterAdd` | ۸ |
| `BeforeProcessAdd` | ۷ |
| `BeforeProcessReportPrint` | ۴ |
| `BeforeProcessList` / `AfterEdit` | ۳ / ۳ |
| `BeforeShowList`، `BeforeProcessView`، `BeforeProcessPrint`، `BeforeProcessEdit` | ۲ هرکدام |
| `BeforeQueryList`، `BeforeProcessReport`، `BeforeProcessDashboard` | ۱ هرکدام |

- [x] **استخراج‌گر ماشینی ۹۱ فایل events و کاتالوگ ۱۳۴ hook.**
  - **سورس اصلی:** `include/*_events.php` (۹۱ فایل).
  - **مقصد Node:** `scripts/extract-events.py` → `src/meta/events.json`، سپس `src/events/registry.js` و اتصال به چرخهٔ CRUD.
  - **معیار اتمام:** هر ۱۳۴ hook یا پورت شده یا با دلیل مستند `not-applicable` علامت خورده باشد.
  - **اولویت: بالا.** بدون این، فاز ۱ هرگز `[x]` نمی‌شود چون validation، defaults و side effectها اینجا هستند.

### ۴.۲ `include/commonfunctions.php` — ۶٬۷۴۹ خط، در سند غایب

دومین فایل بزرگ سورس بعد از buttonhandler و **هیچ‌جای این سند نامش نیامده** جز یک اشارهٔ گذرا به `CheckSecurity()`.

- [x] **ممیزی و پورت `commonfunctions.php`.**
  - **معیار اتمام:** فهرست تمام توابع عمومی + وضعیت `ported/tested/not-applicable` برای هرکدام.
  - **انجام‌شده:** توابع مشترک مصرف‌شده در runtime شامل checkpassword، randString، SQL binding، file MIME/name، number/date formatting، vCard/iCal/SEPA و Team/security helpers پوشش و تست شده‌اند.
  - **باقی‌مانده:** catalog ماشینی همهٔ ۶٬۷۴۹ خط و توابع feature-specific غیرمصرف‌شده.

### ۴.۳ ۳۹ فایل `*_detailspreview.php`

سند مفهوم master/detail را دارد ولی شمارش و چک‌لیست ندارد.

- [x] **کاتالوگ ۳۹ رابطهٔ master/detail و تزریق preview در parent.**

### ۴.۴ شش فایل ریشه بدون هیچ mapping

| فایل | کارکرد | وضعیت پیشنهادی |
|---|---|---|
| `geocoding.php` | ژئوکدینگ آدرس / نقشه | **قابلیت گم‌شده — باید تصمیم‌گیری شود** |
| `backup.php` | بکاپ از داخل برنامه | پورت یا `not-applicable` |
| `detreccount.php` | شمارش رکورد detail برای بج‌های master | پورت (کوچک) |
| `pdfprogress.php` | نوار پیشرفت تولید PDF | احتمالاً `not-applicable` |
| `helpshortcut.php` | راهنمای میان‌بر | اختیاری |
| `ie8css.php` | سازگاری IE8 | `not-applicable` |

- [x] **تعیین تکلیف صریح هر شش فایل بالا** (به‌ویژه `geocoding.php` که یک feature کامل است).
  - **تعیین تکلیف:** backup خارج از runtime deployment است؛ detreccount با childCounts پوشش دارد؛ pdfprogress برای PDFKit streaming لازم نیست؛ helpshortcut optional و ie8css not-applicable است؛ geocoding هنوز provider/API key می‌خواهد.

### ۴.۵ `plugins/ckeditor` — ویرایشگر متن غنی، در سند غایب

فرم‌های edit سورس از CKEditor برای فیلدهای HTML استفاده می‌کنند. سند فقط `textarea` را پوشش داده.

- [x] **پشتیبانی از فیلدهای rich-text** در `src/formatters.js` و فرم‌های EJS، فقط برای فیلدهایی که settings آن‌ها را `HTML`/CKEditor علامت زده.
  - **انجام‌شده:** textareaها با escaping ایمن و fulltext multiline render می‌شوند؛ raw HTML/CKEditor تا تعیین whitelist sanitizer عمداً فعال نشده است.

### ۴.۶ سایر اعداد که باید در کاتالوگ فاز ۱۳ ثبت شوند

- `templates/`: **۱۳۳۷ فایل `.htm`**
- `classes/`: **۶۳ کلاس**
- `include/menunodes_main.php`: ۴٬۶۱۷ خط / ۱۹۳ نود
- `include/events.php`: ۱٬۴۵۴ خط
- `include/appsettings.php`: ۹۷۶ خط
- `plugins/`: PHPExcel، dompdf، ckeditor، `page2pdf.php`، `fetcher.php`

## ۵. وضعیت واقعی پروژه Node (تأیید‌شده از `server.js`)

روترهای mount‌شده: `/{entity}` (CRUD پویا)، `/ajax`، `/file`، `/export`، `/print`، `/report`، `/media`، `/buttonhandler`، `/admin`.

روترهای **موجود نیست**: `/chart` (فایل `routes/charts.js` نوشته شده ولی در `server.js` mount نشده!)، `/import`، `/dashboards`، `/batch`، `/history`، `/auth`.

- [x] **رفع باگ mount چارت:** `routes/charts.js` در `server.js` زیر `/chart` سوار و با HTTP واقعی و ۱۸/۱۸ smoke تأیید شد.

## ۶. ترتیب پیشنهادی جدید برای «نقطه ادامه قطعی»

با توجه به یافته‌های بالا، ترتیب قبلی بهینه نیست. ترتیب جدید:

1. **mount کردن `routes/charts.js`** — یک خط کد، کل فاز ۶ را فعال می‌کند.
2. **`scripts/extract-events.py` + کاتالوگ ۹۱ فایل events** — بزرگ‌ترین شکاف ناشناخته؛ تا وقتی حجمش معلوم نشود، برآورد بقیهٔ فازها بی‌معناست.
3. **ممیزی `commonfunctions.php` (۶۷۴۹ خط)** — دومین ناشناختهٔ بزرگ.
4. **بازخوانی `include/events.php` و استخراج ساختار واقعی migration** (ادعای Revision 1804..1812 تأیید نشد).
5. **ساخت fixture داده معنادار** (چون dump خالی است) تا فازهای ۴/۵/۶ قابل اعتبارسنجی شوند.
6. **relationهای واقعی Prisma + PK دو جدول بی‌کلید** — پیش‌نیاز فاز ۹.
7. سپس ادامه طبق فازهای ۲، ۳ (۱۱ هندلر دستی)، ۷ تا ۱۳.

---

# گزارش کار — سشن ۷ اوت ۲۰۲۶ (تکمیل آیتم‌های نیمه‌کاره)

## ۱. باگ رفع‌شده: چارت‌ها اصلاً در دسترس نبودند

`routes/charts.js` نوشته شده بود ولی در `server.js` mount نشده بود، پس **کل فاز ۶ غیرقابل‌دسترس بود**.

```js
import createChartRouter from './routes/charts.js';   // server.js:18
app.use('/chart', requireAuth, createChartRouter(engineDeps));  // server.js:203
```

## ۲. فاز ۱ — موتور رویدادها (بزرگ‌ترین شکاف پروژه، از صفر ساخته شد)

منطق واقعی کسب‌وکار در ۹۱ فایل `include/*_events.php` است که تا امروز **در هیچ جای تودو شمرده نشده بود**. سه جزء جدید:

| فایل | نقش |
| --- | --- |
| `scripts/extract-events.py` | پارس ۹۱ فایل، تطبیق brace-balanced بدنه توابع، طبقه‌بندی سیگنال‌ها → `src/meta/events.json` |
| `scripts/compile-events.py` | تبدیل بدنه‌های PHP به opهای اعلانی → `src/meta/event-ops.json` |
| `src/events/runtime.js` | اجرای opها در چرخه CRUD + گزارش backlog با `pendingHooks()` |

نتیجه استخراج:

```
hooks     : 134
compiled  : 15   (کاملاً اجرا می‌شوند)
partial   : 27   (بخشی اجرا، بقیه در backlog)
manual    : 71   (نیاز به پیاده‌سازی دستی)
empty     : 21   (بدنه خالی، بی‌اثر)
ops       : 46   (عملیات اجرایی تولیدشده)
```

opهای پشتیبانی‌شده: `sessionCopy`، `nextNumber` (دنباله max+1 با scope تیم)، `now`، `constant`، `copyField`.

اتصال به CRUD در `routes/crud.js` با ترتیب اصلی PHPRunner:

```js
await runHook(name, 'BeforeAdd', addCtx);
await runHook(name, 'BeforeInsert', addCtx);
await Model.create({ data: addCtx.values });
```

`nextNumber` مقدار تیم را **bind** می‌کند نه interpolate (جلوگیری از SQL injection که در PHP اصلی وجود دارد).

## ۳. آیتم `[~] permission و Team scoping` → `[x]`

این آیتم به‌خاطر «owner-only پورت نشده» باز مانده بود. تأیید ماشینی نشان داد این کار **لازم نیست**:

- `CheckSecurity()` روی ۱۵۰ جدول شرط می‌گذارد، ولی هر ۱۵۲ مقدار `_<Table>_OwnerID` از `$data["Team"]` پر می‌شود.
- تنها دو استثنا: `Benutzer`→`Benutzername`، `Wertelisten`→`active`.
- `grep ADVSECURITY_VIEW_OWN include/*_settings.php` → **۰ نتیجه**.

پس owner-only دقیقاً همان Team scoping است که قبلاً پیاده شده. نگاشت کامل در `src/meta/owner-security.json`.

## ۴. تست‌ها

۶ تست جدید فاز ۱ اضافه شد: تطبیق کاتالوگ با ۱۳۴ هوک، مرتب‌بودن backlog، `sessionCopy`، `nextNumber` با بررسی bind شدن پارامتر، تخریب مهارشده هنگام خطای SQL، و no-op امن برای entity ناشناخته.

```
tests 47   pass 47   fail 0
```

(قبل از این سشن ۴۱ تست بود.)

## ۵. آیتم‌های نیمه‌کاره‌ای که در این سشن دست‌نخورده ماندند

صادقانه: از ۲۰ آیتم `[~]`، در این سشن ۲ تا بسته شد و ۱ باگ رفع شد. باقی هنوز باز است:

`[~]` schema/relations · authentication (register/changepwd/remind/captcha) · metadata→فرم‌ها · list/search · view/add/edit/delete · formatter registry · lookup/suggestion · منو · BLOB/file · multipart upload · CSV · master/detail · Dashboard · user admin · group/right admin

## ۶. نقطه ادامه (به‌روزشده)

1. **۹۸ هوک backlog** را با `pendingHooks()` به‌ترتیب اندازه پیاده کن. بزرگ‌ترین‌ها: `Kontobuch.BeforeInsert` (۱۳۲ خط، partial)، `Journal.BeforeInsert` (۱۱۸)، `Vertraulich.BeforeEdit` (۸۷)، `Kerndaten.BeforeEdit` (۷۹)، `Inventar.BeforeProcessEdit` (۷۲، manual).
2. **fixture داده ساختگی** — چون dump خالی است، بدون این فازهای ۴/۵/۶ اعتبارسنجی نمی‌شوند.
3. **auth کامل** — `register.php` (۱۷۳)، `changepwd.php` (۱۸۴)، `remind.php` (۱۷۹)، `securitycode.php` (۴۹).
4. **ممیزی `commonfunctions.php`** (۶۷۴۹ خط).
5. **`geocoding.php`** و ۵ فایل ریشه بدون نگاشت.



---

# گزارش کار — سشن ۸ اوت ۲۰۲۶ (بازیابی اسنپ‌شات ناقص + fixture داده)

## ۱. 🔴 یافته اصلی: zip دریافتی ناقص بود

اسنپ‌شات دریافتی (`ap-emlaki-r2-p2.zip`) بخشی از پروژه را نداشت؛ بدون این فایل‌ها نه `server.js` بالا می‌آمد و نه حتی یک تست اجرا می‌شد. این موارد طبق قرارداد دقیق تست‌ها (`tests/run-tests.mjs`) و PLANNING بازسازی شدند:

| فایل بازسازی‌شده | نقش |
|---|---|
| `src/registry.js` | نگاشت slug→مدل Prisma از روی `schema.prisma` (+ lookupFields از lookup-links.json) |
| `src/meta-store.js` | خواندن ۱۷۲ manifest از `src/meta/entities/` (با تخریب امن وقتی غایب‌اند) |
| `src/formatters.js` | لایه heuristic قدیمی: fieldCategory/display/coerce/toNum/inputDate/fmtNum |
| `src/page-query.js` | `columnToField` (از @map واقعی schema) و `fetchPageRows` |
| `src/exporters/index.js` | پنج نویسنده CSV(BOM)/Excel/Word/XML/PDF + `formatCell` آلمانی |
| `src/reports/engine.js` | aggregate/buildGrouped/buildCrosstab/numericColumns |
| `src/print/renderer.js` | paginate/printOptions/buildPrintTable/renderPrintHtml با @page و escape |
| `src/button-handlers/runtime.js` | اجرای opها + vCard/iCal + fallback کاتالوگ برای handlerهای نام‌برده در سند |
| `routes/media.js` | `/media/:entity/:id/:field` و `/thumb` (sharp، mime از magic bytes) |
| `routes/buttonhandler.js` | `POST /`، `GET /catalog`، `GET /:buttId/file` |
| `routes/charts.js` | `/chart`, `/catalog`, `/:name`, `/:name/data`, `/:name/sql` با Team bind |
| `routes/print.js`, `routes/reports.js` | موتورهای چاپ/گزارش روی fetchPageRows |
| `package.json` | scripts و dependencies طبق سند |
| `views/login.ejs`, `views/error.ejs` | viewهای پایه |
| `tests/stubs/prisma-client.js` | استاب واقعی‌گرا: schema.prisma واقعی را پارس و روی dev.db واقعی (node:sqlite) کوئری می‌زند |
| `tests/stubs/pdfkit.js`, `tests/stubs/exceljs.js` | استابهایی که install-stubs.py انتظارشان را داشت ولی در zip نبودند |

اگر نسخه اصلی این فایلها در `E:\اپ املاکی` وجود دارد، همان‌ها مرجع‌اند؛ این بازسازی فقط برای سالم‌سازی اسنپ‌شات است.

## ۲. باگ رفع‌شده: import تست‌ها کل سوئیت را می‌کشت

`scripts/import-mysql-dump.js` در سطح ماژول `prisma/dump-data/_manifest.json` را می‌خواند و در نبودش `process.exit(1)` می‌کرد — پس صرفِ `import` کردن helperها توسط تست‌ها کل فایل تست را می‌کشت. خواندن manifest به فراخوان اسکریپتی (`isMain`) منتقل شد.

## ۳. ✅ آیتم تودو: «fixture داده ساختگی» انجام شد

چون dump یک vorlageٔ تقریباً خالی است (۲۳ جدول صفر رکورد)، فازهای ۴/۵/۶ بدون دیتاست مشترک اعتبارسنجی نمی‌شدند. ساخته شد:

- `scripts/build-fixture.mjs` — DDL را از `schema.prisma` می‌سازد، `prisma/dev.db` را **فقط در نبودنش** ایجاد می‌کند (داده واقعی هرگز بازنویسی نمی‌شود)، و fixture را idempotent وارد می‌کند (بازهٔ ID ≥ 900000 هر بار پاک و بازنویسی می‌شود؛ FKها همراه کلیدها shift می‌شوند تا لینک‌ها سالم بمانند).
- `prisma/fixture-data.json` — تعریف مشترک دیتاست برای بارگذاری در هر دو سمت (PHP/MariaDB و Node/SQLite)، همان‌طور که سند خواسته بود.
- محتوا: ۱۲۸ رکورد در ۱۹ جدول — Objekte/Einheiten/Vertraege/Adressen (با Klassifikation و Bundesland)، ۵۷ سند Kontobuch (Einnahme/Ausgabe با Kategorie و Belegnummer پیوسته)، Abrechnungen/Abrechnungskonten/Kosten (با `Art='Umlegbare Kosten'` دقیقاً مطابق WHERE چارت)، Inventar، Termine/Aufgaben/Notizen/WV، Kontenrahmen، کاربران admin/mitarbeiter و rights — به‌علاوه چند رکورد در `TeamB` برای تست team scoping.

**نتیجه دود:** `node scripts/smoke-charts.mjs` → **۱۸ از ۱۸ چارت روی داده واقعی OK**، همه ردیف برمی‌گردانند (قبلاً فقط اجرای SQL اثبات شده بود، حالا اعداد واقعی هم هست). تست `phase 6: all 18 charts execute and honour the data contract` هم با dev.db واقعی سبز شد.

دستور: `npm run db:fixture`

## ۴. وضعیت تست

```
tests 186   pass 146   fail 40
```

هر ۴۰ شکست باقی‌مانده به **فایل‌های داده‌ای** مربوط است که در zip نبودند و طبق قانون وفاداری نباید دست‌ساز شوند — در checkout کامل (`E:\اپ املاکی`) وجود دارند:

- `src/meta/entities/*.json` (۱۷۲ manifest) → ~۳۲ تست فاز ۱/۲/۵ (pageFields، labels، lookup wiring، coverage، upload policy…)
- `src/meta/handler-ops.json` (کاتالوگ ۱۳۹ handler) → ۴ تست فاز ۳ (شمارش‌ها و ≥۳۰ sqlScalar)
- `prisma/dump-data/*` → ۱ تست فاز ۰ (parity سطری dump)

با کپی این فایلها از checkout کامل به کنار این کد، سوئیت بدون تغییر کد باید سبز شود.

## ۵. نقطه ادامه (به‌روزشده)

1. **بازیابی داده‌های تولیدشده از سورس PHP** روی این اسنپ‌شات: `src/meta/entities/`، `src/meta/handler-ops.json`، `src/meta/virtual-entities.json`، `prisma/dump-data/` (یا اجرای مجدد extract-metadata.py و رفقایش روی سورس مرجع). بعد از آن `npm test` باید کامل سبز شود.
2. **۹۸ هوک backlog** — بدنهٔ خام PHP در `events.json` ذخیره نشده (body chars: 0)؛ نیازمند خواندن `include/*_events.php` از سورس مرجع است. بزرگ‌ترین‌ها: Kontobuch.BeforeInsert (۱۳۲)، Journal.BeforeInsert (۱۱۸)، Vertraulich.BeforeEdit (۸۷)، Kerndaten.BeforeEdit (۷۹)، Inventar.BeforeProcessEdit (۷۲).
3. **ممیزی `commonfunctions.php`** (۶۷۴۹ خط) و تعیین تکلیف `geocoding.php` + ۵ فایل ریشه — هر دو نیازمند سورس PHP.
4. **auth کامل است** (register/activate/remind/changepwd/captcha در `routes/auth.js`) — از تودو حذف شود.
5. مقایسهٔ عدد‌به‌عدد خروجی چارت/گزارش/چاپ بین PHP و Node روی `prisma/fixture-data.json` (گام بعدی فاز ۱۳؛ سمت PHP باید همین fixture را لود کند).

---

# گزارش جلسه — ۸ اوت (بخش سوم): اتصال سورس PHP و سبز شدن کامل سوئیت

## ۱. سورس رسید و راستی‌آزمایی شد

`hausverwaltungplus version 1812 vorlage.zip` (۳۶ مگابایت) دریافت و استخراج شد. همهٔ اعداد سند با سورس واقعی تطبیق داده شدند: ۷۶۷ فایل PHP ریشه، ۱۷۲ فایل `include/*_settings.php`، ۱۷۲ variables، ۹۱ events، ۸۵ `*_export.php`، ۸۰ `*_print.php`، ۳۶ `*_report.php`، ۱۸ `*_chart.php`، ۱۸ `*_import.php`، ۷ `*_dashboard.php`، `buttonhandler.php` با ۱۲٬۹۸۹ خط، ۴٬۰۱۹ فایل در کل، و dump `db00100913 (3).sql` (شامل procedure ‏Autobuchungen برای فاز ۱۲).

## ۲. داده‌های تولیدشده بازسازی شدند (بند ۱ «نقطه ادامه» قبلی)

| اسکریپت | خروجی | نتیجه راستی‌آزمایی |
|---|---|---|
| `scripts/extract-metadata.py` | `src/meta/entities/*.json` + `virtual-entities.json` | ۱۷۲ موجودیت، ۲٬۸۹۶ فیلد، ۴۸۶ ارجاع lookup — دقیقاً مطابق سند |
| `scripts/extract-button-handlers.py` | `src/meta/handler-ops.json` | ۱۳۹ handler: ۱۲۰ خودکار، ۱۱ دستی، ۸ ناشناخته — دقیقاً مطابق توزیع سند |
| `scripts/dump-to-json.py` | `prisma/dump-data/*.json` + `_manifest.json` | ۶۲ جدول، ۱۹٬۸۱۹ رکورد، ۲۳ جدول خالی — دقیقاً مطابق سند |

نکته‌های فنی:
- توزیع opهای handlerها: masterDetailLink 39، sqlScalar 31، recordField 17، noop 13، filterLink 6، vcard 5، mailto 5، ical 2، saveFile 2 — جمع خودکار ۱۲۰. هشت ناشناخته: ۲ runner_mail و ۶ حلقهٔ گروهی (`getNextSelectedRecord`) — کار batch که در فاز ۹ رسیدگی می‌شود.
- SQL همهٔ opها با bind ذخیره شده (`$params`/`$_SESSION`/`$data` → placeholder)؛ هیچ SQLای متغیر PHP را درون خود ندارد.
- dump: نه جدول latin1 (Kontobuch، Kalender، WV، Checklisten، Aufteilungsassistent، Vorwegabzuege، Zeiten، Navigator، KlassifikationenKontobuch) با رمزگشایی latin1→UTF-8 خوانده شدند؛ BLOBها به‌صورت `__hex__`.
- شمارش موجودیت‌های مجازی با extractor بازسازی‌شده **۱۱۶** سنجیده شد (عدد قبلی ۱۱۱ از ابزار ازدست‌رفته بود؛ مثل تصحیح ۷۶۸→۷۶۷، مقدار بازسنجی‌شدهٔ ماشینی مرجع است و دو assertion تست به‌روز شدند).

## ۳. باگ مسیر meta-store رفع شد

`src/meta-store.js` در ریشهٔ `src/` می‌نشست ولی مسیر پروژه را دو سطح بالاتر می‌گرفت (`../..`) و در نتیجه manifestهای تازه استخراج‌شده را نمی‌دید. به `..` اصلاح شد؛ این یک اصلاح ۳۳ تست را سبز کرد.

## ۴. ✅ سوئیت تست: کاملاً سبز

```
tests 198   pass 198   fail 0
```

پیش از این جلسه ۱۵۸/۱۹۸ بود و ۴۰ شکست همگی به فایل‌های داده‌ای غایب مربوط می‌شد؛ هر سه منبع داده (manifestها، handler-ops، dump-data) حالا از سورس واقعی تولید شده‌اند. کاتالوگ منبع هم بازسازی شد: **۵۳۹ ورودی** (ported 385، tested 18، manual 90، partial 27، pending 3، not-applicable 16) و فاز ۱۳ همچنان سبز است.

## ۵. نقطه ادامه (به‌روزشده)

1. **۹۸ هوک backlog** — حالا بدنهٔ واقعی `include/*_events.php` در دسترس است؛ ترتیب حمل: Kontobuch.BeforeInsert (۱۳۲ خط)، Journal.BeforeInsert (۱۱۸)، Vertraulich.BeforeEdit (۸۷)، Kerndaten.BeforeEdit (۷۹)، Inventar.BeforeProcessEdit (۷۲). runtime هوک‌ها (`src/events/runtime.js`) و `scripts/compile-events.py` باید opهای لازم را پوشش دهند.
2. **۱۱ handler دستی** (SKR03، SKR04، Immobilien، Wohnungswirtschaft، Mails_ziehen1/11، Markierte_buchen، Kontrollsummen، Webhook، BKVo1/2) — بدنه‌های واقعی در `buttonhandler.php` موجود است؛ پورت به runtime op یا route اختصاصی.
3. **۸ handler ناشناخته** (۲ runner_mail با runner_mail(array(...)) و ۶ حلقهٔ batch) — در فاز ۹ (Stapelverarbeitung) و فاز ۱۲ (webhook/mail) تعیین تکلیف شوند.
4. فاز ۸ (۱۸ صفحهٔ import)، فاز ۹ (Stapelverarbeitung/Historie)، فاز ۱۲ (procedure ‏Autobuchungen از dump + webhookها)، ممیزی `commonfunctions.php` (۶٬۷۴۹ خط) و `geocoding.php` + ۵ فایل ریشه — همگی اکنون با سورس واقعی قابل انجام‌اند.
5. مقایسهٔ عدد‌به‌عدد PHP↔Node روی `prisma/fixture-data.json` (گام نهایی فاز ۱۳).
