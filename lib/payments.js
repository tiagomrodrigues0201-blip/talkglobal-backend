// Aqui vamos só validar acesso via Hotmart futuramente

function liberarAcessoManual(user) {
  return {
    ...user,
    status: "active",
    plan: "pro"
  };
}

module.exports = {
  liberarAcessoManual
};
