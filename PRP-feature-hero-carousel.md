# PRP — Pull Request Proposal

**Branch:** `feature/hero-carousel` → `main`  
**Commit:** `c9ae39a chore: update year from 2024 to 2026`  
**Status:** Ready for review

---

## Summary

Annual date refresh and hero-carousel image assets. Updates the establishment/copyright year from **2024 → 2026** across documentation and all page footers, and adds four new hero carousel images to `image/`.

No functional, design-system, or logic changes. Visual/content only.

---

## Changes

| File | Change |
|------|--------|
| `README.md` | Home feature row: `EST. 2024` → `EST. 2026` |
| `pages/about.html` | Meta description, "Born In 2026" heading, stats-strip "Established", footer copyright |
| `pages/account.html` | Footer copyright `2024` → `2026` |
| `pages/cart.html` | Footer copyright `2024` → `2026` |
| `pages/collections.html` | Footer copyright `2024` → `2026` |
| `pages/contact.html` | Footer copyright `2024` → `2026` |
| `pages/login.html` | Footer copyright `2024` → `2026` |
| `pages/product.html` | Footer copyright `2024` → `2026` |
| `pages/shop.html` | Footer copyright `2024` → `2026` |
| `image/40e106dd-7024-40c3-a34f-3f5eed054d31.jpg` | New hero carousel image (added) |
| `image/6baa5efb-17a7-472a-b1f6-c86080fc4a33.jpg` | New hero carousel image (added) |
| `image/920f461e-5cd0-4c84-8ad6-362560b5e931.jpg` | New hero carousel image (added) |
| `image/Puma Style, Comfort, Performance.png` | New hero carousel image (added) |

**Stats:** 13 files changed, 12 insertions, 12 deletions, 4 new images.

---

## Why

- Keep copyright/establishment dates accurate for 2026 (site launched 2024, now two years in).
- Add fresh hero-slide assets so the 3-slide carousel on the home page can rotate new imagery.

---

## Testing checklist

- [ ] Site builds / dev server starts (`npm run dev`)
- [ ] Footer year renders `2026` on all pages (about, account, cart, collections, contact, login, product, shop)
- [ ] About page meta description and "Born In 2026" heading display correctly
- [ ] README `EST. 2026` reads correctly
- [ ] New images load in the hero carousel without broken links
- [ ] No console errors on home page after image swap

---

## Notes / risks

- None. Content/date-only change; no Supabase schema, RLS, auth, or JS logic touched.
- Images are unoptimized raw uploads — consider running them through an image optimizer before final merge if bundle size is a concern.

---

## Suggested reviewers

- `@bnlchb` (repo owner)

---

## Link

Open PR: `feature/hero-carousel` → `main` on [bnlchb/originalfit-storefront](https://github.com/bnlchb/originalfit-storefront)
