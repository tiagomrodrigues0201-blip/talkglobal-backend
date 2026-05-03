const Stripe = require("stripe");

const {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_BASIC,
  STRIPE_PRICE_PRO
} = require("./env");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

function garantirStripeConfigurado() {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY não configurada.");
  }

  return stripe;
}

function normalizarPlano(plan) {
  const plano = String(plan || "").trim().toLowerCase();

  if (plano !== "basic" && plano !== "pro") {
    throw new Error("Plano inválido.");
  }

  return plano;
}

function getStripePriceId(plan) {
  const plano = normalizarPlano(plan);

  if (plano === "basic") {
    if (!STRIPE_PRICE_BASIC) {
      throw new Error("STRIPE_PRICE_BASIC não configurado.");
    }
    return STRIPE_PRICE_BASIC;
  }

  if (!STRIPE_PRICE_PRO) {
    throw new Error("STRIPE_PRICE_PRO não configurado.");
  }
  return STRIPE_PRICE_PRO;
}

function getPlanoPorStripePrice(priceId) {
  const id = String(priceId || "").trim();

  if (id && STRIPE_PRICE_BASIC && id === STRIPE_PRICE_BASIC) return "basic";
  if (id && STRIPE_PRICE_PRO && id === STRIPE_PRICE_PRO) return "pro";

  return null;
}

function getPlanoPorStripeSubscription(subscription = {}) {
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  return (
    getPlanoPorStripePrice(priceId) ||
    subscription?.metadata?.plan ||
    null
  );
}

module.exports = {
  garantirStripeConfigurado,
  getStripePriceId,
  getPlanoPorStripePrice,
  getPlanoPorStripeSubscription,
  normalizarPlano
};
