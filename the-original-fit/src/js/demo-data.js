/* ============================================================================
   THE ORIGINAL FIT — demo-data.js
   Bundled mirror of the Supabase seed (supabase/schema.sql §10).
   Powers the site in DEMO mode (before the backend is connected) and is
   also the shape-map reference for live data.
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function registerDemo(T) {
  const U = (id, w = 1100) =>
    `https://images.unsplash.com/photo-${id}?q=80&w=${w}&auto=format&fit=crop`;

  T.DEMO = {
    categories: [
      {
        id: 1, slug: 'streetwear', name: 'Streetwear',
        image_url: U('1614252369475-531eba835eb1', 1200),
        description: 'Bold silhouettes for the city. Pieces designed to stand out.',
      },
      {
        id: 2, slug: 'minimalist', name: 'Minimalist',
        image_url: U('1627130697816-4d71dbfe6a5b', 1200),
        description: 'Clean lines, quiet colors. Fewer pieces, more presence.',
      },
      {
        id: 3, slug: 'hoodies', name: 'Hoodies',
        image_url: U('1556821840-3a63f95609a7', 1200),
        description: 'Heavyweight comfort layers built for every day.',
      },
    ],

    products: [
      {
        id: 1, name: 'Classic Logo Tee',
        description: 'Our foundational piece. 100% heavyweight cotton jersey, boxy relaxed fit, tonal chest logo. Washed for unbeatable softness from day one.',
        price: 24.99, original_price: null,
        image_url: U('1562157873-818bc0726f68'),
        category_id: 1, category_slug: 'streetwear', category_name: 'Streetwear',
        stock: 42, is_new: true, is_best_seller: true, is_active: true,
        created_at: '2026-10-30T09:00:00Z',
      },
      {
        id: 2, name: 'Minimal Tee',
        description: 'The quiet essential. Pima cotton, fitted cut, tiny embroidered wordmark at the hem. Wears as good under a jacket as on its own.',
        price: 22.99, original_price: null,
        image_url: U('1581655353564-df123a1eb820'),
        category_id: 2, category_slug: 'minimalist', category_name: 'Minimalist',
        stock: 58, is_new: true, is_best_seller: false, is_active: true,
        created_at: '2026-10-29T09:00:00Z',
      },
      {
        id: 3, name: 'Signature Tee',
        description: 'The one that started THE ORIGINAL FIT. Garment-dyed cotton, dropped shoulders, screen-printed signature logo across the back.',
        price: 24.99, original_price: 29.99,
        image_url: U('1592728036073-d0ae31a18fdc'),
        category_id: 1, category_slug: 'streetwear', category_name: 'Streetwear',
        stock: 36, is_new: false, is_best_seller: true, is_active: true,
        created_at: '2026-10-28T09:00:00Z',
      },
      {
        id: 4, name: 'Essential Tee',
        description: 'A masterclass in restraint. Midweight organic cotton, straight hem, zero branding. The tee you will search for every laundry day.',
        price: 22.99, original_price: null,
        image_url: U('1576417677416-6ca3adfb5435'),
        category_id: 2, category_slug: 'minimalist', category_name: 'Minimalist',
        stock: 64, is_new: false, is_best_seller: false, is_active: true,
        created_at: '2026-10-27T09:00:00Z',
      },
      {
        id: 5, name: 'Essential Logo Tee — Black',
        description: 'Deep matte black version of our classic logo tee. Premium combed cotton holds color through every wash.',
        price: 24.99, original_price: null,
        image_url: U('1604897391146-c98ab268e252'),
        category_id: 1, category_slug: 'streetwear', category_name: 'Streetwear',
        stock: 30, is_new: false, is_best_seller: false, is_active: true,
        created_at: '2026-10-25T09:00:00Z',
      },
      {
        id: 6, name: 'Everyday Logo Tee',
        description: 'Built for rotation. Slightly longer body, ribbed collar that keeps its shape, subtle left-chest print.',
        price: 23.99, original_price: null,
        image_url: U('1622445272461-c6580cab8755'),
        category_id: 1, category_slug: 'streetwear', category_name: 'Streetwear',
        stock: 51, is_new: false, is_best_seller: false, is_active: true,
        created_at: '2026-10-22T09:00:00Z',
      },
      {
        id: 7, name: 'Studio Essential Tee',
        description: 'Awfully soft organic cotton tee — cut with a straight drape and finished with tonal stitching. Styled for minimalists.',
        price: 19.99, original_price: 24.99,
        image_url: U('1620799140408-edc6dcb6d633'),
        category_id: 2, category_slug: 'minimalist', category_name: 'Minimalist',
        stock: 73, is_new: false, is_best_seller: false, is_active: true,
        created_at: '2026-10-21T09:00:00Z',
      },
      {
        id: 8, name: 'OG Monochrome Hoodie',
        description: 'Blanket-heavy 420gsm fleece with double-lined hood, kangaroo pocket and tonal embroidery. Your year-round layer.',
        price: 49.99, original_price: 59.99,
        image_url: U('1556821840-3a63f95609a7'),
        category_id: 3, category_slug: 'hoodies', category_name: 'Hoodies',
        stock: 24, is_new: false, is_best_seller: true, is_active: true,
        created_at: '2026-10-19T09:00:00Z',
      },
      {
        id: 9, name: 'Heavyweight Grey Hoodie',
        description: 'Our heaviest build yet — 480gsm brushed fleece, oversized cut, metal-tipped drawcords. Offers warm forever.',
        price: 54.99, original_price: 64.99,
        image_url: U('1611817757591-c3f345024273'),
        category_id: 3, category_slug: 'hoodies', category_name: 'Hoodies',
        stock: 18, is_new: true, is_best_seller: false, is_active: true,
        created_at: '2026-10-16T09:00:00Z',
      },
      {
        id: 10, name: 'Off-Duty Hoodie',
        description: 'Thrown on with everything. Loopback cotton fleece, lived-in softness, relaxed raglan sleeves with hidden side pockets.',
        price: 52.99, original_price: null,
        image_url: U('1738486260590-23c954cf29b8'),
        category_id: 3, category_slug: 'hoodies', category_name: 'Hoodies',
        stock: 27, is_new: false, is_best_seller: false, is_active: true,
        created_at: '2026-10-14T09:00:00Z',
      },
    ],
  };
})(window.TOF);
