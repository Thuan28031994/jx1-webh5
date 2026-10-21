# Deploy tự động Võ Lâm Idle lên thuanlam.qzz.io

Mục tiêu: mỗi khi merge code vào nhánh `main`, GitHub Actions build lại Next.js, chạy
Playwright, rồi direct-upload artifact đã kiểm thử lên Cloudflare Pages
`vli-thuan-2026` (`thuanlam.qzz.io`).

Workflow: `.github/workflows/deploy-thuanlam-pages.yml`.

## Trạng thái: đã bật chạy tự động

Đã merge đầy đủ 2.824 media Patch 01 lên `main`, kèm
`docs/PATCH01-MEDIA-MANIFEST.json`. GitHub Actions kiểm tra
SHA-256 của **tất cả** file trong manifest trước khi upload.

Workflow đã được bật mặc định: push/merge có thay đổi `web/**`,
`game/**` hoặc chính workflow trên nhánh `main` sẽ kích hoạt.
Không cần đặt biến `VLI_PAGES_AUTO_DEPLOY` nữa.

**Vẫn cần** hai GitHub Actions secrets Cloudflare hợp lệ và một lần
chạy thành công để xác nhận triển khai thật. Chỉ có quyền GitHub
repository không đủ để kiểm tra hoặc cấp lại secrets.

## Cloudflare credentials

Vào repo GitHub -> **Settings -> Secrets and variables -> Actions -> Secrets**,
tạo hai **repository secrets**:

- `CLOUDFLARE_API_TOKEN`: tạo custom token trong Cloudflare, tối thiểu
  quyền **Account / Cloudflare Pages / Edit** trên đúng tài khoản chứa project.
- `CLOUDFLARE_ACCOUNT_ID`: Account ID của tài khoản chứa Pages project.

**Không paste token vào code, commit hoặc chat.**

Sau khi tạo secrets, kiểm tra job tại GitHub ->
**Actions -> Deploy thuanlam.qzz.io (Pages)**. Workflow sẽ chạy tự động
khi có commit mới phù hợp hoặc có thể chọn
**Run workflow -> main** để xác minh ngay.

## Bảo vệ production

- `npm ci`, `tsc --noEmit`, Next.js static build.
- Đóng gói `patch02-test-out` riêng; **không overwrite `game/`**.
- Chặn deploy nếu thiếu các media đã xác nhận thuộc Patch 01,
  số file artifact nhỏ hơn 11.500, vượt 20.000 hoặc có file >25 MiB.
- Cài Chromium, chạy toàn bộ Playwright với `VLI_PATCH02_TEST=1` trên
  artifact *đúng là artifact sẽ upload*.
- Chỉ sau khi tất cả đạt mới chạy `wrangler pages deploy ... --branch=main`.
- Post-deploy kiểm tra HTTP 200 của Pages và `thuanlam.qzz.io`.

**CI tự động ở đây chỉ deploy Cloudflare Pages.**
Repo cũng có workflow deploy Workers tới
`vo-lam-idle.tannhatcms.io.vn` và OTA Android riêng; không sửa hai luồng đó.
Cloudflare Direct Upload đã có thể được điều khiển bằng Wrangler từ GitHub
Actions mà không cần tạo Pages project mới.

Nếu cần rollback, vào Cloudflare Dashboard -> Workers & Pages ->
`vli-thuan-2026` -> Deployments để chọn bản production tốt trước đó.
