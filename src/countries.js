// Country names from the browser (Intl), with a few everyday forms.
export const regionNames = {
  ar: new Intl.DisplayNames(['ar'], { type: 'region' }),
  en: new Intl.DisplayNames(['en'], { type: 'region' }),
};

const COUNTRY_NAMES = { PS: { ar: 'فلسطين', en: 'Palestine' }, SA: { ar: 'السعودية' }, AE: { ar: 'الإمارات' } };

export function countryName(code, lang) {
  try {
    return COUNTRY_NAMES[code]?.[lang] ?? regionNames[lang].of(code);
  } catch {
    return code;
  }
}
