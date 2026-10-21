# Deploy tự động Võ Lâm Idle lên thuanlam.qzz.io

Mục tiêu: mỗi khi merge code vào nhánh `main`, GitHub Actions build lại Next.js, chạy
Playwright, rồi direct-upload artifact đã kiểm thử lên Cloudflare Pages
`vli-thuan-2026` (`thuanlam.qzz.io`).

Workflow: `.github/workflows/deploy-thuanlam-pages.yml`.

## Bật một lần (lưu ý quan trọng)

Trước khi bật CI, **phải import đủ toàn bộ media Patch 01 lên GitHub**.
Những tệp này hiện đang có ở máy Windows và trong Pages production, nhưng
chưa được Git theo dõi ở repo:

- `game/fx/c2_101.webp`
- `game/img/a/ani050_st.webp`
- `game/img/jx/f/fm_bd_025_st05.webp`
- `game/ui/jx1/`

Chính vì vậy workflow mặc định **TẮT**: nó sẽ không upload thiếu dữ liệu.
Những tệp khác của Patch 01 cũng phải được commit lên GitHub, không chỉ ba
file kiểm tra được liệt kê ở trên. Không dùng `git clean` hoặc
`git reset --hard`.

Trên Windows, sau khi chuyển sang main mới nhất và xác minh chỉ có các
tài nguyên Patch 01 trong `game/fx`, `game/img`, `game/ui` đang untracked:

```powershell
cd C:\Users\amecopain\VLI\vo-lam-idle
git fetch thuan
git switch main
git merge --ff-only thuan/main
git status --short
git ls-files --others --exclude-standard -- game/fx game/img game/ui
# Chỉ tiếp tục khi đã rà soát file sẽ thêm:
git add -- game/fx game/img game/ui
git diff --cached --stat
git diff --cached --name-status
# Kiểm tra: chỉ file media cần thiết. Nếu thấy thay đổi bất ngờ,
# bỏ stage theo từng file trước khi commit.
git commit -m "Import Patch 01 media for Cloudflare CI"
git push thuan main
```

Nếu thiếu file tài nguyên ở các thư mục khác (ví dụ `game/snd`,
`game/music`, `game/fonts`), cũng phải import đủ trước khi bật.

## Cloudflare credentials

Vào repo GitHub -> **Settings -> Secrets and variables -> Actions -> Secrets**,
tạo hai **repository secrets**:

- `CLOUDFLARE_API_TOKEN`: tạo custom token trong Cloudflare, tối thiểu
  quyền **Account / Cloudflare Pages / Edit** trên đúng tài khoản chứa project.
- `CLOUDFLARE_ACCOUNT_ID`: Account ID của tài khoản chứa Pages project.

**Không paste token vào code, commit hoặc chat.**

Sau khi toàn bộ media đã commit và secrets đã điền, tại
**Settings -> Secrets and variables -> Actions -> Variables**, tạo biến:

- `VLI_PAGES_AUTO_DEPLOY` = `true`

Workflow tự chạy khi push/merge vào `main` có thay đổi `web/**`, `game/**`
hoặc workflow deploy. Muốn chạy bản deploy đầu tiên ngay: GitHub ->
**Actions -> Deploy thuanlam.qzz.io (Pages) -> Run workflow -> main**.

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
