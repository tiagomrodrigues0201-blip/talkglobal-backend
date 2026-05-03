const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_PRICE_BASIC = (process.env.STRIPE_PRICE_BASIC || "").trim();
const STRIPE_PRICE_PRO = (process.env.STRIPE_PRICE_PRO || "").trim();
const CLIENT_SUCCESS_URL = (
  process.env.CLIENT_SUCCESS_URL ||
  "https://web.whatsapp.com/?talkglobal=success"
).trim();
const CLIENT_CANCEL_URL = (
  process.env.CLIENT_CANCEL_URL ||
  "https://web.whatsapp.com/?talkglobal=cancel"
).trim();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  ""
).trim();

const DEVICE_ID_HEADER = "x-talkglobal-device-id";
const DEVICE_NAME_HEADER = "x-talkglobal-device-name";
const DEVICE_ACTIVE_DAYS = 30;
const TRIAL_DAYS = 3;

module.exports = {
  PORT,
  OPENAI_API_KEY,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_BASIC,
  STRIPE_PRICE_PRO,
  CLIENT_SUCCESS_URL,
  CLIENT_CANCEL_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DEVICE_ID_HEADER,
  DEVICE_NAME_HEADER,
  DEVICE_ACTIVE_DAYS,
  TRIAL_DAYS
};
