const {
  RARITIES,
  ARCHETYPES,
  ELEMENTS,
  POWERS,
  WEAPONS,
  ABILITIES,
  SYNERGIES
} = require("./catalog");
const {
  createCardFromSeed,
  normalizeCard,
  getActiveSynergies,
  validateDeckSelection,
  startTutorialBattle,
  resolvePlayerAction: resolveEnginePlayerAction,
  getWinner: getEngineWinner,
  buildProgressionPatch
} = require("./engine");

function getTodayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.USAGE_TIME_ZONE || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function sendError(res, statusCode, error, message) {
  return res.status(statusCode).json({ ok: false, error, message: message || error });
}

function getAuthUserId(req) {
  return req.authUser?.id || req.dbUser?.authUserId || null;
}

async function listPlayerCards(supabase, userId) {
  const { data, error } = await supabase
    .from("player_cards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Erro ao listar cartas: ${error.message}`);
  return (data || []).map(normalizeCard);
}

async function getDeckRows(supabase, userId) {
  const { data, error } = await supabase
    .from("player_decks")
    .select("card_id, slot")
    .eq("user_id", userId)
    .order("slot", { ascending: true });

  if (error) throw new Error(`Erro ao listar baralho: ${error.message}`);
  return data || [];
}

async function getPlayerState(supabase, userId) {
  const cards = await listPlayerCards(supabase, userId);
  const deckRows = await getDeckRows(supabase, userId);
  const deckIds = deckRows.map((row) => row.card_id);
  const deck = deckIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
  const synergies = getActiveSynergies(deck);

  const { data: progression } = await supabase
    .from("player_progression")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    cards,
    deck,
    deckIds,
    synergies,
    progression: progression || {
      user_id: userId,
      level_unlocked: 1,
      tutorial_completed: false,
      victories: 0,
      battles: 0,
      resources: 0
    }
  };
}

function analyzePhotoLocally(photoData) {
  const raw = String(photoData || "");
  if (raw && !raw.startsWith("data:image/")) {
    throw new Error("A foto precisa ser enviada como data URL de imagem.");
  }
  if (raw.length > 7000000) {
    throw new Error("A imagem é grande demais para o MVP. Envie uma foto menor.");
  }
  const signature = raw ? `${raw.length}:${raw.slice(0, 64)}` : "sem-foto";
  const cues = ["Aurora", "Nimbo", "Prisma", "Eco", "Vesper", "Âmbar", "Rubi", "Cobalto"];
  const cue = cues[raw.length % cues.length];
  return {
    signature,
    visualCue: cue,
    analysisMode: raw ? "deterministic-local-pending-openai-vision" : "no-photo"
  };
}

async function createInitialCards({ supabase, userId, photoProfile }) {
  const today = getTodayKey();
  const payload = [0, 1, 2].map((slot) => ({
    ...createCardFromSeed({ userId, slot, rarityId: "comum", photoProfile }),
    initial_slot: slot + 1
  }));

  const { data, error } = await supabase.rpc("create_initial_card_set", {
    p_user_id: userId,
    p_generation_date: today,
    p_photo_profile: photoProfile,
    p_cards: payload
  });

  if (error) {
    throw new Error(`Erro ao criar cartas iniciais: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const cards = rows.map((row) => normalizeCard(row.card)).filter(Boolean);
  const created = rows.some((row) => row.created === true);
  const reason = rows[0]?.reason || (created ? "initial_cards_created" : "initial_cards_already_created");
  return { created, reason, cards };
}

function buildBattleState(playerDeck) {
  return startTutorialBattle(playerDeck);
}

async function saveBattle(supabase, userId, state, winner) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("battles")
    .insert({
      user_id: userId,
      mode: "tutorial",
      status: winner ? "finished" : "active",
      winner,
      state,
      rewards: winner === "player" ? { experience: 20, resources: 10, unlockedLevel: 2 } : {},
      created_at: now,
      updated_at: now
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao registrar batalha: ${error.message}`);
  return data;
}

function registerCartasRoutes(app, { supabase, verificarAuth }) {
  app.get("/cartas/catalog", (_req, res) => {
    return res.json({
      ok: true,
      rarities: RARITIES,
      archetypes: ARCHETYPES,
      elements: ELEMENTS,
      powers: POWERS,
      weapons: WEAPONS,
      abilities: ABILITIES,
      synergies: SYNERGIES
    });
  });

  app.get("/cartas/me", verificarAuth, async (req, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return sendError(res, 401, "user_not_found", "Usuário do banco não encontrado.");
      const state = await getPlayerState(supabase, userId);
      return res.json({ ok: true, ...state });
    } catch (error) {
      return sendError(res, 500, "cards_state_failed", error.message);
    }
  });

  app.post("/cartas/initial-cards", verificarAuth, async (req, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return sendError(res, 401, "user_not_found", "Usuário do banco não encontrado.");
      const photoProfile = analyzePhotoLocally(req.body?.photoData);
      const result = await createInitialCards({ supabase, userId, photoProfile });
      const state = await getPlayerState(supabase, userId);
      return res.status(result.created ? 201 : 200).json({ ok: true, ...result, state });
    } catch (error) {
      return sendError(res, 500, "initial_cards_failed", error.message);
    }
  });

  app.post("/cartas/deck", verificarAuth, async (req, res) => {
    try {
      const userId = getAuthUserId(req);
      const cardIds = Array.isArray(req.body?.cardIds) ? req.body.cardIds.slice(0, 3) : [];
      if (!userId) return sendError(res, 401, "user_not_found", "Usuário do banco não encontrado.");
      if (cardIds.length !== 3) return sendError(res, 400, "invalid_deck", "O baralho precisa ter exatamente 3 cartas.");

      const cards = await listPlayerCards(supabase, userId);
      const deckValidation = validateDeckSelection({ cards, userId, cardIds });
      if (!deckValidation.ok) {
        return sendError(res, deckValidation.error === "card_not_owned" ? 403 : 400, deckValidation.error, "Baralho inválido.");
      }

      const now = new Date().toISOString();
      await supabase.from("player_decks").delete().eq("user_id", userId);
      const { error } = await supabase.from("player_decks").insert(cardIds.map((cardId, index) => ({
        user_id: userId,
        card_id: cardId,
        slot: index + 1,
        updated_at: now
      })));
      if (error) throw new Error(`Erro ao salvar baralho: ${error.message}`);

      const state = await getPlayerState(supabase, userId);
      return res.json({ ok: true, ...state });
    } catch (error) {
      return sendError(res, 500, "deck_save_failed", error.message);
    }
  });

  app.post("/cartas/battle/tutorial", verificarAuth, async (req, res) => {
    try {
      const userId = getAuthUserId(req);
      if (!userId) return sendError(res, 401, "user_not_found", "Usuário do banco não encontrado.");
      const current = await getPlayerState(supabase, userId);
      if (current.deck.length < 3) return sendError(res, 400, "deck_required", "Crie as 3 cartas iniciais antes do tutorial.");

      const state = buildBattleState(current.deck);
      const battle = await saveBattle(supabase, userId, state, null);
      return res.status(201).json({ ok: true, battleId: battle.id, state });
    } catch (error) {
      return sendError(res, 500, "battle_start_failed", error.message);
    }
  });

  app.post("/cartas/battle/:battleId/action", verificarAuth, async (req, res) => {
    try {
      const userId = getAuthUserId(req);
      const battleId = req.params.battleId;
      const { data: battle, error } = await supabase
        .from("battles")
        .select("*")
        .eq("id", battleId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw new Error(`Erro ao buscar batalha: ${error.message}`);
      if (!battle) return sendError(res, 404, "battle_not_found", "Batalha não encontrada.");
      if (battle.status === "finished") return res.json({ ok: true, battleId, state: battle.state, winner: battle.winner, rewards: battle.rewards || {} });

      const actionResult = resolveEnginePlayerAction(battle.state, req.body?.action || { type: "attack" });
      if (!actionResult.ok) {
        return sendError(res, 400, actionResult.error, actionResult.error);
      }
      const state = actionResult.state;
      const winner = getEngineWinner(state);

      let rewards = {};
      if (winner) {
        const current = await getPlayerState(supabase, userId);
        const progressionPatch = buildProgressionPatch({ winner, current: current.progression });
        rewards = progressionPatch.rewards;
        await supabase.from("player_progression").upsert({
          user_id: userId,
          tutorial_completed: progressionPatch.tutorial_completed,
          level_unlocked: progressionPatch.level_unlocked,
          victories: progressionPatch.victories,
          battles: progressionPatch.battles,
          resources: progressionPatch.resources,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
      }

      const { error: updateError } = await supabase
        .from("battles")
        .update({
          state,
          status: winner ? "finished" : "active",
          winner,
          rewards,
          updated_at: new Date().toISOString()
        })
        .eq("id", battleId);

      if (updateError) throw new Error(`Erro ao atualizar batalha: ${updateError.message}`);
      return res.json({ ok: true, battleId, state, winner, rewards });
    } catch (error) {
      return sendError(res, 500, "battle_action_failed", error.message);
    }
  });
}

module.exports = {
  registerCartasRoutes
};
