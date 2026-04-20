/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex('project').whereNull('language').update({ language: 'ZH_CN' });

  return knex.schema.alterTable('project', (table) => {
    table.string('language').defaultTo('ZH_CN').alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  return knex.schema.alterTable('project', (table) => {
    table.string('language').defaultTo('EN').alter();
  });
};
