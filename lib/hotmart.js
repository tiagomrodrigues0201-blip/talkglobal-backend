const HOTMART_WEBHOOK_TOKEN = (process.env.HOTMART_WEBHOOK_TOKEN || "").trim();
const HOTMART_PRODUCT_ID = (process.env.HOTMART_PRODUCT_ID || "").trim();
const HOTMART_BASIC_OFFER_CODE = (process.env.HOTMART_BASIC_OFFER_CODE || "").trim();
const HOTMART_PRO_OFFER_CODE = (process.env.HOTMART_PRO_OFFER_CODE || "").trim();
const HOTMART_BASIC_CHECKOUT_URL = (process.env.HOTMART_BASIC_CHECKOUT_URL || "").trim();
const HOTMART_PRO_CHECKOUT_URL = (process.env.HOTMART_PRO_CHECKOUT_URL || "").trim();

function getHotmartCheckoutUrl(plan) {
  const p = String(plan || "").toLowerCase();

  if (p === "basic") {
    if (!HOTMART_BASIC_CHECKOUT_URL) {
      throw new Error("HOTMART_BASIC_CHECKOUT_URL não configurada.");
    }
    return HOTMART_BASIC_CHECKOUT_URL;
  }

  if (p === "pro") {
    if (!HOTMART_PRO_CHECKOUT_URL) {
      throw new Error("HOTMART_PRO_CHECKOUT_URL não configurada.");
    }
    return HOTMART_PRO_CHECKOUT_URL;
  }

  throw new Error("Plano inválido.");
}

function getPlanoPorHotmart(dados = {}) {
  const offerCode =
    String(
      dados?.offer_code ||
      dados?.offer ||
      dados?.data?.offer?.code ||
      dados?.data?.purchase?.offer?.code ||
      ""
    ).trim();

  if (offerCode && HOTMART_BASIC_OFFER_CODE && offerCode === HOTMART_BASIC_OFFER_CODE) {
    return "basic";
  }

  if (offerCode && HOTMART_PRO_OFFER_CODE && offerCode === HOTMART_PRO_OFFER_CODE) {
    return "pro";
  }

  const nomePlano = String(
    dados?.plan ||
    dados?.data?.subscription?.plan?.name ||
    dados?.data?.purchase?.offer?.name ||
    ""
  ).toLowerCase();

  if (nomePlano.includes("basic")) return "basic";
  if (nomePlano.includes("pro")) return "pro";

  return null;
}

function validarTokenHotmart(req) {
  const tokenRecebido =
    String(
      req.headers["x-hotmart-hottok"] ||
      req.headers["x-hotmart-token"] ||
      req.headers["hotmart-hottok"] ||
      ""
    ).trim();

  if (!HOTMART_WEBHOOK_TOKEN) {
    throw new Error("HOTMART_WEBHOOK_TOKEN não configurado.");
  }

  return tokenRecebido && tokenRecebido === HOTMART_WEBHOOK_TOKEN;
}

module.exports = {
  HOTMART_WEBHOOK_TOKEN,
  HOTMART_PRODUCT_ID,
  HOTMART_BASIC_OFFER_CODE,
  HOTMART_PRO_OFFER_CODE,
  HOTMART_BASIC_CHECKOUT_URL,
  HOTMART_PRO_CHECKOUT_URL,
  getHotmartCheckoutUrl,
  getPlanoPorHotmart,
  validarTokenHotmart
};
