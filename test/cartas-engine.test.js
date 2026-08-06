const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RARITIES,
  POWERS,
  WEAPONS,
  ABILITIES,
  SYNERGIES
} = require("../lib/cartas/catalog");
const {
  createCardFromSeed,
  createInitialCardsSet,
  createInitialCardsIfNeeded,
  normalizeCard,
  getActiveSynergies,
  calculateAttackDamage,
  startTutorialBattle,
  resolvePlayerAction,
  getWinner,
  buildProgressionPatch,
  validateDeckSelection
} = require("../lib/cartas/engine");

function idsAreUnique(items) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function namesAreUnique(items) {
  return new Set(items.map((item) => item.name)).size === items.length;
}

function card(slot = 0, userId = "user-a", rarityId = "comum") {
  return normalizeCard({
    id: `card-${userId}-${slot}`,
    user_id: userId,
    ...createCardFromSeed({
      userId,
      slot,
      rarityId,
      photoProfile: { signature: "test-photo", visualCue: "Teste", analysisMode: "test" }
    }),
    created_at: new Date().toISOString()
  });
}

test("catalogo tem 100 poderes, 100 armas e IDs/nomes estáveis", () => {
  assert.equal(POWERS.length, 100);
  assert.equal(WEAPONS.length, 100);
  assert.equal(idsAreUnique(POWERS), true);
  assert.equal(idsAreUnique(WEAPONS), true);
  assert.equal(namesAreUnique(POWERS), true);
  assert.equal(namesAreUnique(WEAPONS), true);
});

test("habilidades e sinergias usam tipos compatíveis com o motor", () => {
  const abilityTypes = new Set(["damage", "shield", "speed", "heal", "pierce", "energy"]);
  assert.equal(ABILITIES.every((ability) => abilityTypes.has(ability.type)), true);
  assert.equal(SYNERGIES.every((synergy) => synergy.id && synergy.match && synergy.bonus), true);
});

test("gera exatamente 3 cartas iniciais comuns e é idempotente em memória", () => {
  const generated = createInitialCardsSet({ userId: "user-a", photoProfile: { signature: "abc", visualCue: "Aurora" } });
  assert.equal(generated.length, 3);
  assert.equal(generated.every((item) => item.rarity === "comum"), true);

  const first = createInitialCardsIfNeeded({ existingCards: [], userId: "user-a", photoProfile: { signature: "abc" } });
  assert.equal(first.created, true);
  const existing = first.cards.map((item, index) => normalizeCard({ id: `i-${index}`, user_id: "user-a", ...item, created_at: new Date().toISOString() }));
  const second = createInitialCardsIfNeeded({ existingCards: existing, userId: "user-a", photoProfile: { signature: "abc" } });
  assert.equal(second.created, false);
  assert.equal(second.reason, "initial_cards_already_created");
});

test("atributos respeitam faixas por raridade", () => {
  for (const rarityId of Object.keys(RARITIES)) {
    const generated = card(0, "user-range", rarityId);
    assert.equal(generated.rarity, rarityId);
    assert.ok(generated.atk >= 1 && generated.atk <= 180);
    assert.ok(generated.def >= 1 && generated.def <= 180);
    assert.ok(generated.spd >= 1 && generated.spd <= 180);
    assert.ok(generated.eng >= 0 && generated.eng <= 14);
    assert.ok(generated.hp >= 1 && generated.hp <= 520);
  }
});

test("regra de superioridade Mítica vence confronto simples contra raridade inferior", () => {
  const mythic = { ...card(0, "m", "mitica"), atk: 10 };
  const rare = { ...card(0, "r", "rara"), def: 200 };
  const result = calculateAttackDamage(mythic, rare);
  assert.equal(result.damage >= 1, true);
});

test("dano básico cobre ataque maior, igual e menor que defesa", () => {
  assert.equal(calculateAttackDamage({ atk: 70, rarity: "comum" }, { def: 50, rarity: "comum" }).damage, 20);
  assert.equal(calculateAttackDamage({ atk: 50, rarity: "comum" }, { def: 50, rarity: "comum" }).damage, 0);
  assert.equal(calculateAttackDamage({ atk: 40, rarity: "comum" }, { def: 50, rarity: "comum" }).damage, 0);
});

test("sinergias são calculadas para baralho", () => {
  const deck = [
    { ...card(0), weaponFamily: "lâmina", elementId: "solar" },
    { ...card(1), weaponFamily: "lâmina", elementId: "vento" },
    { ...card(2), weaponFamily: "escudo", elementId: "metal" }
  ];
  const synergies = getActiveSynergies(deck);
  assert.equal(synergies.some((item) => item.id === "laminas_duplas"), true);
  assert.equal(synergies.some((item) => item.id === "trindade_equilibrada"), true);
});

test("defesa reduz resposta inimiga e habilidade gasta energia", () => {
  const deck = [card(0), card(1), card(2)];
  let state = startTutorialBattle(deck);
  const beforeDefendHp = state.player.deck[0].currentHp;
  const defended = resolvePlayerAction(state, { type: "defend" });
  assert.equal(defended.ok, true);
  assert.ok(defended.state.player.deck[0].currentHp >= beforeDefendHp - 20);

  state = startTutorialBattle(deck);
  const beforeEnergy = state.player.deck[0].eng;
  const ability = resolvePlayerAction(state, { type: "ability" });
  assert.equal(ability.ok, true);
  assert.ok(ability.state.player.deck[0].eng < beforeEnergy);
});

test("troca de carta, vitória e derrota são resolvidas", () => {
  const deck = [card(0), card(1), card(2)];
  let state = startTutorialBattle(deck);
  const switched = resolvePlayerAction(state, { type: "switch", cardIndex: 1 });
  assert.equal(switched.ok, true);
  assert.equal(switched.state.activePlayerIndex, 1);

  state = startTutorialBattle(deck);
  state.enemy.deck.forEach((enemy) => { enemy.currentHp = 0; });
  assert.equal(getWinner(state), "player");

  state = startTutorialBattle(deck);
  state.player.deck.forEach((player) => { player.currentHp = 0; });
  assert.equal(getWinner(state), "enemy");
});

test("progressão concede experiência e nível ao vencer tutorial", () => {
  const won = buildProgressionPatch({ winner: "player", current: { level_unlocked: 1, victories: 0, battles: 0, resources: 0 } });
  assert.equal(won.tutorial_completed, true);
  assert.equal(won.level_unlocked, 2);
  assert.equal(won.rewards.experience, 20);

  const lost = buildProgressionPatch({ winner: "enemy", current: { level_unlocked: 1, victories: 0, battles: 0, resources: 0 } });
  assert.equal(lost.level_unlocked, 1);
  assert.deepEqual(lost.rewards, {});
});

test("ações inválidas e fora do turno são recusadas", () => {
  const state = startTutorialBattle([card(0), card(1), card(2)]);
  assert.equal(resolvePlayerAction(state, { type: "dance" }).ok, false);
  state.phase = "enemy";
  assert.equal(resolvePlayerAction(state, { type: "attack" }).error, "not_player_turn");
});

test("validação de baralho impede duplicadas e carta de outro usuário", () => {
  const owned = [card(0, "owner"), card(1, "owner"), card(2, "owner")];
  const foreign = card(9, "other");
  assert.equal(validateDeckSelection({ cards: owned, userId: "owner", cardIds: owned.map((item) => item.id) }).ok, true);
  assert.equal(validateDeckSelection({ cards: owned, userId: "owner", cardIds: [owned[0].id, owned[0].id, owned[1].id] }).error, "duplicate_card");
  assert.equal(validateDeckSelection({ cards: [...owned, foreign], userId: "owner", cardIds: [owned[0].id, owned[1].id, foreign.id] }).error, "card_not_owned");
});
