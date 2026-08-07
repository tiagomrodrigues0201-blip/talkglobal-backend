const test = require("node:test");
const assert = require("node:assert/strict");
const { createVerificarAuthCartas, registerCartasRoutes } = require("../lib/cartas/routes");

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const DB_AUTH_USER_ID = "22222222-2222-4222-8222-222222222222";

function makeRpcCard(index, userId = AUTH_USER_ID) {
  const slot = index + 1;
  return {
    id: `00000000-0000-4000-8000-00000000000${slot}`,
    user_id: userId,
    character_name: `Carta Teste ${slot}`,
    image_url: null,
    description: "Carta comum inicial de teste.",
    archetype_id: "guardiao",
    archetype_name: "Guardiao",
    element_id: ["solar", "metal", "vento"][index],
    element_name: ["Solar", "Metal", "Vento"][index],
    power_id: `power-${slot}`,
    power_name: `Poder ${slot}`,
    weapon_id: `weapon-${slot}`,
    weapon_name: `Arma ${slot}`,
    weapon_family: ["lamina", "escudo", "precisao"][index],
    ability_id: `ability-${slot}`,
    ability_name: `Habilidade ${slot}`,
    rarity: "comum",
    rarity_label: "Comum",
    atk: 40 + slot,
    def: 30 + slot,
    spd: 20 + slot,
    eng: 3,
    hp: 120 + slot,
    current_hp: 120 + slot,
    level: 1,
    experience: 0,
    origin: "initial",
    source_type: "initial",
    is_initial: true,
    initial_slot: slot,
    metadata: {},
    created_at: new Date(0).toISOString()
  };
}

function makeRpcRows(reason = "initial_cards_created", created = true, userId = AUTH_USER_ID) {
  return [0, 1, 2].map((index) => ({
    created,
    reason,
    card: makeRpcCard(index, userId)
  }));
}

function makeRecorderSupabase({ rpcRows = makeRpcRows(), rpcError = null } = {}) {
  const calls = [];
  const tableData = {
    player_cards: rpcRows.map((row) => row.card),
    player_decks: rpcRows.map((row, index) => ({ card_id: row.card.id, slot: index + 1 })),
    player_progression: {
      user_id: rpcRows[0]?.card?.user_id || AUTH_USER_ID,
      level_unlocked: 1,
      tutorial_completed: false,
      victories: 0,
      battles: 0,
      resources: 0
    }
  };

  function query(table) {
    const chain = {
      select(columns) {
        calls.push({ type: "select", table, columns });
        return chain;
      },
      eq(column, value) {
        calls.push({ type: "eq", table, column, value });
        return chain;
      },
      order(column, options) {
        calls.push({ type: "order", table, column, options });
        return Promise.resolve({ data: tableData[table] || [], error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: tableData[table] || null, error: null });
      },
      insert(payload) {
        calls.push({ type: "insert", table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      upsert(payload) {
        calls.push({ type: "upsert", table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        calls.push({ type: "delete", table });
        return chain;
      }
    };
    return chain;
  }

  return {
    calls,
    rpc(name, params) {
      calls.push({ type: "rpc", name, params });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      return Promise.resolve({ data: rpcRows, error: null });
    },
    from(table) {
      calls.push({ type: "from", table });
      return query(table);
    }
  };
}

function makeApp({ supabase, authUser, dbUser }) {
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push({ method: "GET", path, handlers });
    },
    post(path, ...handlers) {
      routes.push({ method: "POST", path, handlers });
    }
  };

  registerCartasRoutes(app, {
    supabase,
    verificarAuth(req, _res, next) {
      if (authUser !== undefined) req.authUser = authUser;
      if (dbUser !== undefined) req.dbUser = dbUser;
      next();
    }
  });

  const route = routes.find((entry) => entry.method === "POST" && entry.path === "/cartas/initial-cards");
  assert.ok(route, "POST /cartas/initial-cards route should be registered");
  return route.handlers;
}

async function request(handlers, { body = { photoData: "" } } = {}) {
  const req = { body };
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  let nextCalled = false;

  await handlers[0](req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  await handlers[1](req, res);

  return { status: res.statusCode, json: res.payload };
}

test("cartas initial-cards usa req.authUser.id como UUID principal", async () => {
  const supabase = makeRecorderSupabase();
  const app = makeApp({
    supabase,
    authUser: { id: AUTH_USER_ID },
    dbUser: { id: "public-user-id-never-used", authUserId: DB_AUTH_USER_ID }
  });

  const response = await request(app);
  const rpcCall = supabase.calls.find((call) => call.type === "rpc");

  assert.equal(response.status, 201);
  assert.equal(rpcCall.params.p_user_id, AUTH_USER_ID);
});

test("cartas initial-cards nao usa req.dbUser.authUserId legado como fallback", async () => {
  const supabase = makeRecorderSupabase();
  const app = makeApp({
    supabase,
    dbUser: { id: "public-user-id-never-used", authUserId: DB_AUTH_USER_ID }
  });

  const response = await request(app);

  assert.equal(response.status, 401);
  assert.equal(response.json.error, "user_not_found");
  assert.equal(supabase.calls.some((call) => call.type === "rpc"), false);
});

test("cartas initial-cards nunca utiliza req.dbUser.id como UUID de cartas", async () => {
  const supabase = makeRecorderSupabase();
  const app = makeApp({ supabase, dbUser: { id: "public-user-id-never-used" } });

  const response = await request(app);

  assert.equal(response.status, 401);
  assert.equal(response.json.error, "user_not_found");
  assert.equal(supabase.calls.some((call) => call.type === "rpc"), false);
});

test("cartas initial-cards retorna erro sem UUID compatível com auth.users.id", async () => {
  const supabase = makeRecorderSupabase();
  const app = makeApp({ supabase });

  const response = await request(app);

  assert.equal(response.status, 401);
  assert.equal(response.json.error, "user_not_found");
  assert.equal(supabase.calls.length, 0);
});

test("cartas initial-cards chama somente a RPC create_initial_card_set para geração inicial", async () => {
  const supabase = makeRecorderSupabase();
  const app = makeApp({ supabase, authUser: { id: AUTH_USER_ID } });

  const response = await request(app);
  const rpcCalls = supabase.calls.filter((call) => call.type === "rpc");
  const writeCalls = supabase.calls.filter((call) => ["insert", "upsert", "delete"].includes(call.type));

  assert.equal(response.status, 201);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "create_initial_card_set");
  assert.deepEqual(rpcCalls[0].params.p_cards.map((card) => card.initial_slot), [1, 2, 3]);
  assert.equal(rpcCalls[0].params.p_cards.length, 3);
  assert.equal(rpcCalls[0].params.p_cards.every((card) => card.rarity === "comum"), true);
  assert.equal(rpcCalls[0].params.p_cards.every((card) => card.is_initial === true), true);
  assert.equal(writeCalls.some((call) => call.table === "player_cards"), false);
  assert.equal(writeCalls.some((call) => call.table === "player_decks"), false);
  assert.equal(writeCalls.some((call) => call.table === "card_generations"), false);
  assert.equal(writeCalls.some((call) => call.table === "player_progression"), false);
});

test("cartas initial-cards trata retorno initial_cards_created", async () => {
  const supabase = makeRecorderSupabase({ rpcRows: makeRpcRows("initial_cards_created", true) });
  const app = makeApp({ supabase, authUser: { id: AUTH_USER_ID } });

  const response = await request(app);

  assert.equal(response.status, 201);
  assert.equal(response.json.created, true);
  assert.equal(response.json.reason, "initial_cards_created");
  assert.equal(response.json.cards.length, 3);
});

test("cartas initial-cards trata retorno idempotente initial_cards_already_created", async () => {
  const supabase = makeRecorderSupabase({ rpcRows: makeRpcRows("initial_cards_already_created", false) });
  const app = makeApp({ supabase, authUser: { id: AUTH_USER_ID } });

  const response = await request(app);

  assert.equal(response.status, 200);
  assert.equal(response.json.created, false);
  assert.equal(response.json.reason, "initial_cards_already_created");
  assert.equal(response.json.cards.length, 3);
});

test("cartas initial-cards trata erro da RPC sem iniciar outras gravações", async () => {
  const supabase = makeRecorderSupabase({ rpcError: { message: "rpc failed" } });
  const app = makeApp({ supabase, authUser: { id: AUTH_USER_ID } });

  const response = await request(app);
  const writeCalls = supabase.calls.filter((call) => ["insert", "upsert", "delete"].includes(call.type));

  assert.equal(response.status, 500);
  assert.equal(response.json.error, "initial_cards_failed");
  assert.equal(supabase.calls.filter((call) => call.type === "rpc").length, 1);
  assert.equal(writeCalls.length, 0);
});

function makeAuthResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test("verificarAuthCartas rejeita requisicao sem bearer token sem consultar tabelas legadas", async () => {
  const calls = [];
  const supabase = {
    auth: {
      getUser(token) {
        calls.push({ type: "getUser", token });
        return Promise.resolve({ data: { user: null }, error: null });
      }
    },
    from(table) {
      calls.push({ type: "from", table });
      throw new Error(`legacy table should not be used: ${table}`);
    }
  };
  const middleware = createVerificarAuthCartas(supabase);
  const req = { headers: {} };
  const res = makeAuthResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "token_not_sent");
  assert.equal(nextCalled, false);
  assert.deepEqual(calls, []);
});

test("verificarAuthCartas valida token diretamente no Supabase Auth e popula req.authUser", async () => {
  const calls = [];
  const supabase = {
    auth: {
      getUser(token) {
        calls.push({ type: "getUser", token });
        return Promise.resolve({ data: { user: { id: AUTH_USER_ID, email: "player@example.com" } }, error: null });
      }
    },
    from(table) {
      calls.push({ type: "from", table });
      throw new Error(`legacy table should not be used: ${table}`);
    }
  };
  const middleware = createVerificarAuthCartas(supabase);
  const req = { headers: { authorization: "Bearer valid-token" } };
  const res = makeAuthResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(req.authUser.id, AUTH_USER_ID);
  assert.deepEqual(calls, [{ type: "getUser", token: "valid-token" }]);
});

test("verificarAuthCartas rejeita token invalido sem criar usuario ou dispositivo legado", async () => {
  const calls = [];
  const supabase = {
    auth: {
      getUser(token) {
        calls.push({ type: "getUser", token });
        return Promise.resolve({ data: { user: null }, error: { message: "invalid" } });
      }
    },
    from(table) {
      calls.push({ type: "from", table });
      throw new Error(`legacy table should not be used: ${table}`);
    }
  };
  const middleware = createVerificarAuthCartas(supabase);
  const req = { headers: { authorization: "Bearer invalid-token" } };
  const res = makeAuthResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, "invalid_token");
  assert.equal(nextCalled, false);
  assert.deepEqual(calls, [{ type: "getUser", token: "invalid-token" }]);
});
