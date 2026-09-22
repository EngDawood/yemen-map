export const strings = {
  ar: {
    title: 'خريطة اليمن',
    toggle: 'English',
    search: 'ابحث عن محافظة أو مديرية',
    noResults: 'لا توجد نتائج',
    yemen: 'اليمن',
    governorate: 'محافظة',
    district: 'مديرية',
    governorates: 'المحافظات',
    districts: 'المديريات',
    capital: 'العاصمة',
    population: 'السكان',
    area: 'المساحة',
    density: 'الكثافة',
    idps: 'النازحون',
    km2: 'كم²',
    perKm2: 'نسمة/كم²',
    noData: 'لا تتوفر بيانات',
    back: 'رجوع',
    hint: 'اختر محافظة من الخريطة أو القائمة.',
    sources: 'المصادر: الحدود الإدارية من OCHA COD-AB، وتقديرات السكان 2025 من فريق عمل السكان في اليمن، عبر HDX.',
  },
  en: {
    title: 'Yemen Map',
    toggle: 'عربي',
    search: 'Search a governorate or district',
    noResults: 'No results',
    yemen: 'Yemen',
    governorate: 'Governorate',
    district: 'District',
    governorates: 'Governorates',
    districts: 'Districts',
    capital: 'Capital',
    population: 'Population',
    area: 'Area',
    density: 'Density',
    idps: 'IDPs',
    km2: 'km²',
    perKm2: 'people/km²',
    noData: 'No data',
    back: 'Back',
    hint: 'Pick a governorate on the map or from the list.',
    sources: 'Sources: boundaries from OCHA COD-AB, 2025 population estimates from the Yemen Population Taskforce, via HDX.',
  },
};

const formatters = {
  ar: new Intl.NumberFormat('ar-YE'),
  en: new Intl.NumberFormat('en-US'),
};

export function fmt(n, lang) {
  return n == null ? '—' : formatters[lang].format(Math.round(n));
}
