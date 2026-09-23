// Small HTML helpers shared by the Yemen and Ghurba panels.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function stat(label, value, unit = '') {
  return `<div class="stat"><dt>${label}</dt><dd>${value}${unit ? ` <small>${unit}</small>` : ''}</dd></div>`;
}

// parts: [label, attributes] pairs; a part without attributes is the current page.
export function crumbs(parts) {
  return `<nav class="crumbs">${parts
    .map(([label, attr]) => (attr ? `<button type="button" ${attr}>${esc(label)}</button>` : `<span>${esc(label)}</span>`))
    .join('<span class="sep" aria-hidden="true">›</span>')}</nav>`;
}
