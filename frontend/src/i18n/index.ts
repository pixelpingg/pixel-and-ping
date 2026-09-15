import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fa from "./locales/fa.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";

export const RTL_LANGUAGES = ["fa"];

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fa", label: "فارسی" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
];

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fa: { translation: fa },
    ru: { translation: ru },
    zh: { translation: zh },
  },
  lng: localStorage.getItem("pp_lang") ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function applyDirection(lang: string) {
  const dir = RTL_LANGUAGES.includes(lang) ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
}

export function changeLanguage(lang: string) {
  i18n.changeLanguage(lang);
  localStorage.setItem("pp_lang", lang);
  applyDirection(lang);
}

applyDirection(i18n.language);

export default i18n;
