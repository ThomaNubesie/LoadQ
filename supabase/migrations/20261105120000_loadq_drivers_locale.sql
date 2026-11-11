-- loadq_drivers_locale
-- Store a driver's preferred app language so server-side SMS (ride offers, cascade
-- notices) can be sent in French when the driver chose French. The app persists
-- this on language change (hooks/useStrings.setLang, alongside passengers.locale).
-- Null defaults to English.
alter table public.drivers add column if not exists locale text;
