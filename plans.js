export const PLANS = {
  basic: {
    key: "basic",
    priceId: process.env.STRIPE_PRICE_BASIC
  },
  pro: {
    key: "pro",
    priceId: process.env.STRIPE_PRICE_PRO
  }
};

export function getPlan(plan) {
  const p = PLANS[String(plan).toLowerCase()];

  if (!p) {
    throw new Error("Plano inválido");
  }

  return p;
}
