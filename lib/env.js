const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DEVICE_ID_HEADER,
  DEVICE_NAME_HEADER,
  DEVICE_ACTIVE_DAYS,
  TRIAL_DAYS
};
