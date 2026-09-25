# روان یار

پروژه شامل سایت کاربر، پنل مدیریت، Cloudflare Worker، D1 و R2 است.

## اتصال Cloudflare
1. D1 با نام `ravan-yar-db` بسازید و ID آن را در `wrangler.toml` جایگزین کنید.
2. R2 Bucket با نام `ravan-yar-media` بسازید.
3. دو Secret روی Worker بسازید:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
4. Migration:
`npx wrangler d1 migrations apply ravan-yar-db --remote`
5. Deploy:
`npx wrangler deploy`

پنل: `/admin.html`

نکته: در وب، قفل دستگاه با شناسه تصادفی ذخیره‌شده در مرورگر پیاده شده و «سیستم‌عامل فیزیکی» را نمی‌توان با قطعیت تشخیص داد. پاک شدن LocalStorage یا تعویض مرورگر می‌تواند شناسه را تغییر دهد.
