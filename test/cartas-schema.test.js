const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const schema = readFileSync(join(__dirname, "..", "supabase-cartas-ia-schema.sql"), "utf8");
const normalized = schema.replace(/\s+/g, " ").toLowerCase();

function has(pattern) {
  return pattern.test(schema);
}

function hasNormalized(text) {
  return normalized.includes(text.toLowerCase());
}

test("migration define RPC transacional create_initial_card_set com search_path seguro", () => {
  assert.equal(has(/create\s+or\s+replace\s+function\s+public\.create_initial_card_set\s*\(\s*p_user_id\s+uuid,\s*p_generation_date\s+date,\s*p_photo_profile\s+jsonb,\s*p_cards\s+jsonb\s*\)/i), true);
  assert.equal(has(/security\s+definer/i), true);
  assert.equal(has(/set\s+search_path\s*=\s*''/i), true);
  assert.equal(has(/set\s+search_path\s*=\s*pg_catalog/i), false);
});

test("migration protege concorrencia e valida payload inicial", () => {
  assert.equal(has(/pg_advisory_xact_lock/i), true);
  assert.equal(has(/v_cards_count\s*<>\s*3/i), true);
  assert.equal(has(/rarity'[\s\S]+?<>\s*'comum'/i), true);
  assert.equal(has(/initial_slot'[\s\S]+?!~\s*'\^\[1-3\]\$'/i), true);
  assert.equal(has(/v_slots\s*<>\s*array\[1,\s*2,\s*3\]/i), true);
});

test("migration possui constraints finais de player_cards", () => {
  assert.equal(has(/constraint\s+player_cards_user_id_id_key\s+unique\s*\(\s*user_id\s*,\s*id\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*current_hp\s*>=\s*0\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*current_hp\s*<=\s*hp\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*hp\s*>=\s*1\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*level\s*>=\s*1\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*experience\s*>=\s*0\s*\)/i), true);
});

test("migration possui FK composta de player_decks e remove FK simples antiga", () => {
  assert.equal(has(/foreign\s+key\s*\(\s*user_id\s*,\s*card_id\s*\)\s+references\s+public\.player_cards\s*\(\s*user_id\s*,\s*id\s*\)\s+on\s+delete\s+cascade/i), true);
  assert.equal(has(/card_id\s+uuid\s+not\s+null\s+references\s+public\.player_cards\s*\(\s*id\s*\)/i), false);
  assert.equal(has(/references\s+public\.player_cards\s*\(\s*id\s*\)/i), false);
});

test("migration possui limites nao negativos de progressao", () => {
  assert.equal(has(/check\s*\(\s*level_unlocked\s*>=\s*1\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*victories\s*>=\s*0\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*battles\s*>=\s*0\s*\)/i), true);
  assert.equal(has(/check\s*\(\s*resources\s*>=\s*0\s*\)/i), true);
});

test("migration restringe execucao da RPC ao service_role", () => {
  const signature = "public.create_initial_card_set(uuid, date, jsonb, jsonb)";
  assert.equal(hasNormalized(`revoke all on function ${signature} from public;`), true);
  assert.equal(hasNormalized(`revoke all on function ${signature} from anon;`), true);
  assert.equal(hasNormalized(`revoke all on function ${signature} from authenticated;`), true);
  assert.equal(hasNormalized(`grant execute on function ${signature} to service_role;`), true);
});

test("migration nao depende de public.users nem auth_user_id", () => {
  assert.equal(has(/public\.users/i), false);
  assert.equal(has(/auth_user_id/i), false);
});

test("migration nao concede escrita direta a clientes", () => {
  assert.equal(has(/grant\s+(insert|update|delete)/i), false);
  assert.equal(has(/for\s+(insert|update|delete)\s+to\s+(anon|authenticated)/i), false);
});
