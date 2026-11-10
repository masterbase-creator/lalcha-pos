// One drawn icon per kind of shop, in a single style: 2.5px ink lines on a 32px grid, with one lime
// accent shape each. Emoji looked different on every phone; these look the same everywhere.

const ink = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
const lime = 'fill="var(--accent)"';

const ICONS = {
  // Basket with handle and slats
  grocery: `<path ${lime} d="M6 14h20l-2.2 11a2 2 0 0 1-2 1.6H10.2a2 2 0 0 1-2-1.6z"/><path ${ink} d="M4 14h24M6 14l2.2 11a2 2 0 0 0 2 1.6h11.6a2 2 0 0 0 2-1.6L26 14M11 14l4-8M21 14l-4-8M12.5 18.5v4M16 18.5v4M19.5 18.5v4"/>`,
  // Shopfront with striped awning
  general_store: `<path ${lime} d="M5 6h22l2 6H3z"/><path ${ink} d="M5 6h22l2 6H3zM3 12a3.3 3.3 0 0 0 6.5 0 3.3 3.3 0 0 0 6.5 0 3.3 3.3 0 0 0 6.5 0 3.3 3.3 0 0 0 6.5 0M5.5 15v12h21V15M13 27v-7h6v7M10 6l-1.5 6M16 6v6M22 6l1.5 6"/>`,
  // Capsule and a cross
  pharmacy: `<path ${lime} d="M9.5 22.5l6-6 4 4-6 6a2.8 2.8 0 0 1-4-4z"/><path ${ink} d="M13.5 26.5l11-11a4.2 4.2 0 0 0-6-6l-11 11a4.2 4.2 0 0 0 6 6zM13 15l4 4M24 22v6M21 25h6"/>`,
  // Plate between fork and knife
  restaurant: `<circle ${lime} cx="16" cy="17" r="5.5"/><circle ${ink} cx="16" cy="17" r="8"/><path ${ink} d="M4 5v6a2 2 0 0 0 2 2v14M6 5v4M8 5v6a2 2 0 0 1-2 2M27 27V5c-2.2 1.3-3 4-3 7v5h3"/>`,
  // Tea glass with steam
  tea_stall: `<path ${lime} d="M10.2 18h11.6l-1 8.2a1.8 1.8 0 0 1-1.8 1.6h-6a1.8 1.8 0 0 1-1.8-1.6z"/><path ${ink} d="M8.5 12h15l-1.9 14.3a1.8 1.8 0 0 1-1.8 1.5h-7.6a1.8 1.8 0 0 1-1.8-1.5zM10.2 18h11.6M13.5 3.5c-1.5 1.5 1.5 2.5 0 4.5M18.5 3.5c-1.5 1.5 1.5 2.5 0 4.5"/>`,
  // Hammer crossed with a spanner
  hardware: `<path ${lime} d="M5 9l5-5 4 4-5 5z"/><path ${ink} d="M5 9l5-5 4 4-5 5zM12 11l15 15M22.5 5.5a4.5 4.5 0 0 0-5.8 5.8L5.5 22.5a2.1 2.1 0 0 0 3 3l11.2-11.2a4.5 4.5 0 0 0 5.8-5.8L23 11l-2.5-.5L20 8z"/>`,
  // Sofa
  furniture: `<path ${lime} d="M9 17h14v4H9z"/><path ${ink} d="M7 15V10a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5M4 17a2.5 2.5 0 0 1 5 0v4h14v-4a2.5 2.5 0 0 1 5 0v7H4zM7 24v3M25 24v3"/>`,
  // Phone with a screen
  electronics: `<path ${lime} d="M11.5 7.5h9v14h-9z"/><rect ${ink} x="9" y="3" width="14" height="26" rx="3"/><path ${ink} d="M14 25.5h4"/>`,
  // Gear with a spanner slot
  auto_parts: `<circle ${lime} cx="16" cy="16" r="4.5"/><path ${ink} d="M16 4v3.2M16 24.8V28M28 16h-3.2M7.2 16H4M24.5 7.5l-2.3 2.3M9.8 22.2l-2.3 2.3M24.5 24.5l-2.3-2.3M9.8 9.8L7.5 7.5"/><circle ${ink} cx="16" cy="16" r="8.8"/><circle ${ink} cx="16" cy="16" r="4.5"/>`,
  // T-shirt
  fashion: `<path ${lime} d="M11 15h10v12H11z"/><path ${ink} d="M12 4a4 4 0 0 0 8 0l7 3.5-2.5 6L21 12v15H11V12l-3.5 1.5L5 7.5z"/>`,
  // Faceted gem
  jewellery: `<path ${lime} d="M10 12h12l-6 15z"/><path ${ink} d="M9.5 5h13l5 7L16 27 4.5 12zM4.5 12h23M12.5 5L10 12l6 15 6-15-2.5-7"/>`,
  // Lipstick
  cosmetics: `<path ${lime} d="M12.5 13V8.5L19.5 5v8z"/><path ${ink} d="M12.5 13V8.5L19.5 5v8M10 13h12v4H10zM11 17h10v10H11z"/>`,
  // Glasses
  optical: `<circle ${lime} cx="9" cy="19" r="3.5"/><circle ${lime} cx="23" cy="19" r="3.5"/><circle ${ink} cx="9" cy="19" r="5.5"/><circle ${ink} cx="23" cy="19" r="5.5"/><path ${ink} d="M14.5 18.5c1-1.3 2-1.3 3 0M3.5 18L6 9.5M28.5 18L26 9.5"/>`,
  // Open book with a pencil
  stationery: `<path ${lime} d="M4 8.5c3-1.3 6.5-1.3 10 .5v15c-3.5-1.8-7-1.8-10-.5z"/><path ${ink} d="M4 8.5c3-1.3 6.5-1.3 10 .5v15c-3.5-1.8-7-1.8-10-.5zM14 9v15M21 6l5 5-9 9h-5v-5z"/>`,
  // Layer cake with a candle
  bakery: `<path ${lime} d="M6 18h20v8H6z"/><path ${ink} d="M6 13h20v14H6zM4 27h24M6 18c2.2 1.8 4.4 1.8 6.7 0 2.2 1.8 4.4 1.8 6.6 0 2.3 1.8 4.5 1.8 6.7 0M16 13V8M16 3.5c-1.2 1.3-1.2 2.6 0 3.5 1.2-.9 1.2-2.2 0-3.5z"/>`,
  // Wheat stalk
  agro: `<path ${lime} d="M16 9c-3-1-4.5-3.5-4.5-6 3 .5 4.5 3 4.5 6zM16 9c3-1 4.5-3.5 4.5-6-3 .5-4.5 3-4.5 6z"/><path ${ink} d="M16 29V7M16 13c-3-1-4.5-3.5-4.5-6 3 .5 4.5 3 4.5 6zM16 13c3-1 4.5-3.5 4.5-6-3 .5-4.5 3-4.5 6zM16 20c-3-1-4.5-3.5-4.5-6 3 .5 4.5 3 4.5 6zM16 20c3-1 4.5-3.5 4.5-6-3 .5-4.5 3-4.5 6zM16 9c-3-1-4.5-3.5-4.5-6 3 .5 4.5 3 4.5 6zM16 9c3-1 4.5-3.5 4.5-6-3 .5-4.5 3-4.5 6z"/>`,
  // Stacked cartons
  wholesale: `<path ${lime} d="M10 5h12v8H10z"/><path ${ink} d="M10 5h12v8H10zM4 15h12v12H4zM16 15h12v12H16zM14 5v3M8.5 15v3M22.5 15v3"/>`,
  // Price tag
  general: `<path ${lime} d="M17 4h9a2 2 0 0 1 2 2v9L16.5 26.5 5.5 15.5z"/><path ${ink} d="M17 4h9a2 2 0 0 1 2 2v9L16.5 26.5a2.1 2.1 0 0 1-3 0l-8-8a2.1 2.1 0 0 1 0-3z"/><circle cx="22.5" cy="9.5" r="2" fill="currentColor"/>`,
};

/** The icon's drawing alone, for the share images drawn at build time. */
export const shopIconInner = (type) => ICONS[type] ?? ICONS.general;

/** The icon for a shop type, sized by CSS. Decorative: the card's heading names the shop. */
export const shopIcon = (type) => `<svg class="ico" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${ICONS[type] ?? ICONS.general}</svg>`;
